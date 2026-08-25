import { BusTracker } from "@/components/bus-tracker"

export default function Page() {
  return <BusTracker />
}

// Evitar HTML cacheado sin pasar por middleware de sesión
export const dynamic = "force-dynamic"
