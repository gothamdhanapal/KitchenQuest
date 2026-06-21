import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "");
  const redirectTo = `${process.env.APP_URL ?? new URL(request.url).origin}/auth/callback`;

  if (!email) {
    return NextResponse.redirect(new URL("/?auth=missing_email", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
    },
  });

  if (error) {
    console.error("Supabase magic link sign-in failed", {
      status: error.status,
      code: error.code,
      message: error.message,
    });

    const failedUrl = new URL("/", request.url);
    failedUrl.searchParams.set("auth", "sign_in_failed");
    failedUrl.searchParams.set("message", error.message);

    return NextResponse.redirect(failedUrl);
  }

  return NextResponse.redirect(new URL("/?auth=check_email", request.url));
}
