use falcon::falcon::verify_uncompressed;

const FALCON_N: u32 = 512;
const Q:        u32 = 12289;

const STATUS_ACTIVE:     u8 = 0;
const STATUS_TERMINATED: u8 = 1;
const STATUS_COMPLETED:  u8 = 2;

const SEVERITY_CLASS_I:   u8 = 0;
const SEVERITY_CLASS_II:  u8 = 1;
const SEVERITY_CLASS_III: u8 = 2;

#[derive(Drop, Serde, starknet::Store, Copy)]
pub struct RecallEntry {
    pub drug_name_hash: felt252,
    pub data_hash:      felt252,
    pub status:         u8,
    pub severity:       u8,
    pub published_at:   u64,
    pub is_valid:       bool,
}

#[starknet::interface]
pub trait IDrugSafetyOracle<TContractState> {
    fn publish_recall(
        ref self: TContractState,
        recall_id:      felt252,
        drug_name_hash: felt252,
        data_hash:      felt252,
        status:         u8,
        severity:       u8,
        timestamp:      u64,
        cid:            ByteArray,
        signature:      Array<felt252>,
    );

    fn get_recall(self: @TContractState, recall_id: felt252) -> RecallEntry;
    fn get_recall_cid(self: @TContractState, recall_id: felt252) -> ByteArray;
    fn get_recall_count(self: @TContractState) -> u32;
    fn get_recall_id_by_index(self: @TContractState, idx: u32) -> felt252;
    fn is_recall_active(self: @TContractState, recall_id: felt252) -> bool;
    fn verify_data_integrity(self: @TContractState, recall_id: felt252, data_hash: felt252) -> bool;

    fn upload_pk_chunk(ref self: TContractState, chunk: Array<u16>, offset: u32);
    fn is_pk_ready(self: @TContractState) -> bool;
    fn get_public_key(self: @TContractState) -> Array<u16>;
}

#[starknet::contract]
pub mod DrugSafetyOracle {
    use super::{verify_uncompressed, FALCON_N, Q, STATUS_ACTIVE, RecallEntry};
    use core::poseidon::PoseidonTrait;
    use core::hash::HashStateTrait;
    use starknet::storage::{
        Vec, VecTrait, MutableVecTrait,
        Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::get_contract_address;

    #[storage]
    struct Storage {
        public_key:   Vec<u16>,
        pk_hash:      felt252,
        pk_loaded:    u32,
        recalls:      Map<felt252, RecallEntry>,
        recall_cid:   Map<felt252, ByteArray>,
        recall_count: u32,
        recall_index: Map<u32, felt252>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        OracleDeployed:  OracleDeployed,
        RecallPublished: RecallPublished,
        PkChunkUploaded: PkChunkUploaded,
    }

    #[derive(Drop, starknet::Event)]
    struct OracleDeployed {
        #[key]
        address: starknet::ContractAddress,
        pk_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RecallPublished {
        #[key]
        pub recall_id:      felt252,
        pub drug_name_hash: felt252,
        pub data_hash:      felt252,
        pub severity:       u8,
        pub timestamp:      u64,
        pub cid:            ByteArray,
    }

    #[derive(Drop, starknet::Event)]
    struct PkChunkUploaded {
        offset:       u32,
        total_loaded: u32,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pk_hash: felt252) {
        self.pk_hash.write(pk_hash);
        self.pk_loaded.write(0);
        self.recall_count.write(0);
        self.emit(OracleDeployed {
            address: get_contract_address(),
            pk_hash,
        });
    }

    #[abi(embed_v0)]
    impl DrugSafetyOracleImpl of super::IDrugSafetyOracle<ContractState> {

        fn publish_recall(
            ref self: ContractState,
            recall_id:      felt252,
            drug_name_hash: felt252,
            data_hash:      felt252,
            status:         u8,
            severity:       u8,
            timestamp:      u64,
            cid:            ByteArray,
            signature:      Array<felt252>,
        ) {
            // ── Guard 1: PK must be loaded all ──────────────────
            assert(self.pk_loaded.read() == FALCON_N, 'Oracle PK not ready');

            // ── Guard 2: Prevent duplicate ──────────────────────────────
            let existing = self.recalls.read(recall_id);
            assert(!existing.is_valid, 'Recall already published');

            // ── Guard 3: Signature length should 2*N ─────────────────
            assert(signature.len() == 2 * FALCON_N, 'Invalid signature length');

            // ── Step 1: Compute msg_hash ──────────────────────────────
            //
            //  msg_hash = Poseidon(recall_id, data_hash)
            //
            //  Chain of trust:
            //    recall JSON -> IPFS -> CID
            //    Poseidon(CID bytes) = data_hash
            //    Poseidon(recall_id, data_hash) = msg_hash
            //    hash_to_point_poseidon(msg_hash) = msg_point
            //    Falcon-512 sign dengan msg_point = (s2, msg_point)
            //    verify on-chain -> PQS enforcement
            let msg_hash = PoseidonTrait::new()
                .update(recall_id)
                .update(data_hash)
                .finalize();

            // ── Step 2: Recompute msg_point on-chain ─
            //
            //  MUST be identical to hash_to_point_poseidon() in signer.py:
            //    state = msg_hash
            //    for k in 0..N:
            //        hash_val = Poseidon(state, k)
            //        coef     = hash_val % Q
            //        state    = hash_val
            //
            //  Why Poseidon isn't SHAKE-256:
            //      - SHAKE-256 isn't available in Cairo without a SNIP-32 syscall
            //      - Poseidon is a Cairo builtin -> free gas
            //      - Security remains intact: Falcon's security comes from the NTRU lattice
            //      not from the hash function used for hash_to_point
            let expected_msg_point = self._hash_to_point_poseidon(msg_hash);

            // ── Step 3: Parse s2 and provided_msg_point from calldata ──
            let mut s2:                 Array<u16> = ArrayTrait::new();
            let mut provided_msg_point: Array<u16> = ArrayTrait::new();

            let mut i: u32 = 0;
            loop {
                if i >= FALCON_N { break; }
                let s2_val: u16 = (*signature.at(i))
                    .try_into()
                    .expect('s2 coef out of range');
                let mp_val: u16 = (*signature.at(i + FALCON_N))
                    .try_into()
                    .expect('msg_point coef out of range');
                s2.append(s2_val);
                provided_msg_point.append(mp_val);
                i += 1;
            };

            // ── Step 4: MESSAGE BINDING CHECK ─────────────────────────
            //
            //  Verify that the msg_point passed by the publisher
            //  is IDENTICAL to the one we recompute from (recall_id, data_hash).
            //
            //  Without this: an attacker could retrieve a valid (s2, msg_point) from
            //  another context and submit it with fake recall data.
            //  With this: TX REVERT if msg_point is not bound to data.
            let mut j: u32 = 0;
            loop {
                if j >= FALCON_N { break; }
                assert(
                    *expected_msg_point.at(j) == *provided_msg_point.at(j),
                    'Message binding failed'
                );
                j += 1;
            };

            // ── Step 5: FALCON-512 VERIFICATION ───────────────────────
            //
            //  verify_uncompressed checks:
            //    s0 = msg_point - s2 * pk   (polynomial mod q)
            //    norm^2(s0, s2) ≤ sig_bound  (34034726 for N=512)
            //
            //  Attackers cannot forge without the Falcon-512 private key
            //  because they must solve the Short Integer Solution (SIS) problem
            //  -> quantum-resistant (lattice problem)
            let pk = self._read_public_key();
            match verify_uncompressed::<512>(
                s2.span(),
                pk.span(),
                provided_msg_point.span(),
                FALCON_N,
            ) {
                Result::Ok(_)  => {},
                Result::Err(_) => panic!("Invalid Falcon signature"),
            }

            // ── Step 6: Saved recall ──────────────────────────────────
            let entry = RecallEntry {
                drug_name_hash,
                data_hash,
                status,
                severity,
                published_at: timestamp,
                is_valid: true,
            };
            self.recalls.write(recall_id, entry);
            self.recall_cid.write(recall_id, cid.clone());

            let count = self.recall_count.read();
            self.recall_index.write(count, recall_id);
            self.recall_count.write(count + 1);

            self.emit(RecallPublished {
                recall_id,
                drug_name_hash,
                data_hash,
                severity,
                timestamp,
                cid,
            });
        }

        fn get_recall(self: @ContractState, recall_id: felt252) -> RecallEntry {
            let entry = self.recalls.read(recall_id);
            assert(entry.is_valid, 'Recall not found');
            entry
        }

        fn get_recall_cid(self: @ContractState, recall_id: felt252) -> ByteArray {
            let entry = self.recalls.read(recall_id);
            assert(entry.is_valid, 'Recall not found');
            self.recall_cid.read(recall_id)
        }

        fn get_recall_count(self: @ContractState) -> u32 {
            self.recall_count.read()
        }

        fn get_recall_id_by_index(self: @ContractState, idx: u32) -> felt252 {
            assert(idx < self.recall_count.read(), 'Index out of range');
            self.recall_index.read(idx)
        }

        fn is_recall_active(self: @ContractState, recall_id: felt252) -> bool {
            let entry = self.recalls.read(recall_id);
            entry.is_valid && entry.status == STATUS_ACTIVE
        }

        fn verify_data_integrity(
            self: @ContractState,
            recall_id: felt252,
            data_hash: felt252,
        ) -> bool {
            let entry = self.recalls.read(recall_id);
            if !entry.is_valid { return false; }
            entry.data_hash == data_hash
        }

        fn upload_pk_chunk(ref self: ContractState, chunk: Array<u16>, offset: u32) {
            let loaded = self.pk_loaded.read();
            assert(loaded < FALCON_N, 'PK already fully loaded');
            assert(offset == loaded,  'Wrong offset');
            assert(chunk.len() > 0,   'Empty chunk');

            let mut i: u32 = 0;
            loop {
                if i >= chunk.len() { break; }
                self.public_key.push(*chunk.at(i));
                i += 1;
            };

            let new_loaded = loaded + chunk.len();
            self.pk_loaded.write(new_loaded);

            if new_loaded == FALCON_N {
                let pk       = self._read_public_key();
                let computed = self._compute_pk_hash(pk.span());
                assert(computed == self.pk_hash.read(), 'PK hash mismatch!');
            }

            self.emit(PkChunkUploaded { offset, total_loaded: new_loaded });
        }

        fn is_pk_ready(self: @ContractState) -> bool {
            self.pk_loaded.read() == FALCON_N
        }

        fn get_public_key(self: @ContractState) -> Array<u16> {
            self._read_public_key()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {

        // ── hash_to_point_poseidon ─────────────────────────────────────
        //
        //  MUST be identical to hash_to_point_poseidon() in signer.py.
        //  Any changes here MUST be followed by changes in Python.
        //
        //  Sponge chain:
        //    state[0]   = msg_hash
        //    state[k+1] = Poseidon(state[k], k)
        //    coef[k]    = state[k+1] % Q
        fn _hash_to_point_poseidon(
            self: @ContractState,
            msg_hash: felt252,
        ) -> Array<u16> {
            let mut point: Array<u16> = ArrayTrait::new();
            let mut state: felt252    = msg_hash;
            let mut k: u32 = 0;

            loop {
                if k >= FALCON_N { break; }

                // Mirror Python: poseidon_hash_many([state, k])
                let hash_val: felt252 = PoseidonTrait::new()
                    .update(state)
                    .update(k.into())
                    .finalize();

                // coef = hash_val % Q, cast ke u16
                let hash_u256: u256 = hash_val.into();
                let coef_u256: u256 = hash_u256 % Q.into();
                let coef: u16       = coef_u256.try_into().expect('coef overflow');

                point.append(coef);

                // Update state -> chain to the next iterations
                state = hash_val;
                k += 1;
            };

            point
        }

        fn _read_public_key(self: @ContractState) -> Array<u16> {
            let mut pk: Array<u16> = ArrayTrait::new();
            let len: u32           = self.public_key.len().try_into().unwrap();
            let mut i: u32 = 0;
            loop {
                if i >= len { break; }
                pk.append(self.public_key.at(i.into()).read());
                i += 1;
            };
            pk
        }

        fn _compute_pk_hash(self: @ContractState, pk: Span<u16>) -> felt252 {
            let mut state = PoseidonTrait::new();
            let mut i: u32 = 0;
            loop {
                if i >= pk.len() { break; }
                let coef: felt252 = (*pk.at(i)).into();
                state = state.update(coef);
                i += 1;
            };
            state.finalize()
        }
    }
}
