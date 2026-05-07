import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  console.error("[API Error]", error);
  const message = error instanceof Error ? error.message : "Unexpected request error";
  return NextResponse.json({ error: message }, { status: 500 });
}
