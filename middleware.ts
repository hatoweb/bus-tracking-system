export { auth as middleware } from "@/auth"

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|ico|svg)$).*)",
  ],
}
