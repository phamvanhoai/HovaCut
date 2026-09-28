import "./globals.css";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata = {
	title: "HovaCut Desktop",
	description: "Trình dựng video HovaCut chạy trực tiếp trên máy tính",
};

export default function DesktopLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="vi" suppressHydrationWarning>
			<body className="font-sans antialiased">
				<ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
					<TooltipProvider>
						<Toaster />
						{children}
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
