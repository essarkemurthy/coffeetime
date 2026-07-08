import { redirect } from "next/navigation";

export default function Home() {
  // Middleware sends logged-out users to /login.
  redirect("/dashboard");
}
