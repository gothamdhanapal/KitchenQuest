import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "FreshLoop",
  description: "Personal pantry management powered by Gmail order parsing.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
