VENV_BIN 	     = $(shell pwd)/venv/bin
PYTHON 			 = $(VENV_BIN)/python
ACCOUNT          = $(shell grep -m1 '^ACCOUNT=' .env | cut -d= -f2)
ORACLE_CONTRACT  = $(shell grep -m1 '^ORACLE_CONTRACT=' .env | cut -d= -f2)
ORACLE_CLASS_HASH= $(shell grep -m1 '^ORACLE_CLASS_HASH=' .env | cut -d= -f2)
ORACLE_PK_HASH 	 = $(shell jq -r '.pk_hash' signer/oracle_key.json)
AMOUNT_RECALL 	?= 5

build:
	scarb build

dev:
	cd frontend && npm run dev

check-account:
	cat ~/.starknet_accounts/starknet_open_zeppelin_accounts.json

declare-oracle:
	sncast --account $(ACCOUNT) declare --contract-name DrugSafetyOracle --network sepolia

py-keygen-oracle:
	$(PYTHON) signer/keygen.py --out signer/oracle_key.json

deploy-oracle:
	sncast --account $(ACCOUNT) deploy \
	--network sepolia \
	--class-hash $(ORACLE_CLASS_HASH)  \
	--arguments $(ORACLE_PK_HASH)

py-deploy-oracle:
	$(PYTHON) signer/deploy.py --address $(ORACLE_CONTRACT) --key signer/oracle_key.json

check-fda:
	curl "https://api.fda.gov/drug/enforcement.json?limit=5&sort=recall_initiation_date:desc" \
	| $(PYTHON) -m json.tool | \
	grep -E "recall_number|recall_initiation_date|report_date|status"

py-dry-run:
	$(PYTHON) oracle/publisher.py --dry-run

py-publish:
	$(PYTHON) oracle/publisher.py --test --limit $(AMOUNT_RECALL) --account $(ACCOUNT)

py-test-binding:
	$(PYTHON) oracle/test_binding.py --account $(ACCOUNT)
