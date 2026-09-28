export function generateStaticParams() {
	return [{ project_id: "desktop" }];
}

export default function EditorRouteLayout({ children }: { children: React.ReactNode }) {
	return children;
}
