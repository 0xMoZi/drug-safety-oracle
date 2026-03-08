import type { Metadata } from "next";
import { Instrument_Serif, DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
    weight: ["400"],
    subsets: ["latin"],
    variable: "--font-serif",
});

const dmSans = DM_Sans({
    subsets: ["latin"],
    variable: "--font-sans",
});

const dmMono = DM_Mono({
    weight: ["400", "500"],
    subsets: ["latin"],
    variable: "--font-mono",
});

export const metadata: Metadata = {
    title: "PQ Drug Safety Oracle",
    description:
        "Post-quantum drug recall oracle on StarkNet — powered by Falcon signatures",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html
            lang="en"
            className={`${instrumentSerif.variable} ${dmSans.variable} ${dmMono.variable}`}
        >
            <body className="bg-[#F7F8FA] text-slate-800 font-sans antialiased">
                {children}
            </body>
        </html>
    );
}
