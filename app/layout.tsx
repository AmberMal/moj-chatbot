import type { Metadata } from "next";
import "./globals.css";
import BackForwardGuard from "./back-forward-guard";

export const metadata: Metadata = {
  title: "Amber Chatbot",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pl">
      <body>
        <BackForwardGuard />
        {children}
      </body>
    </html>
  );}



