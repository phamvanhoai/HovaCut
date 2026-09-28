import { Suspense } from "react";
import Editor from "@/app/editor/[project_id]/page";

export default function DesktopEditorPage() {
	return (
		<Suspense fallback={<div className="h-screen w-screen bg-background" />}>
			<Editor />
		</Suspense>
	);
}
