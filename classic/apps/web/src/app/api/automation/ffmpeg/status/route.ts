import { NextResponse } from "next/server";
import { getFfmpegStatus } from "@/automation/server/ffmpeg";

export const runtime = "nodejs";

export async function GET() {
	return NextResponse.json(await getFfmpegStatus());
}
