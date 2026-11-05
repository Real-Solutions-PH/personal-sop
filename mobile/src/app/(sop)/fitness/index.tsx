import { FirstOpenSetup } from "@/prototype/first-open-setup"
import { FitnessHome } from "@/prototype/screens/fitness"
export default function Page() {
  return (
    <FirstOpenSetup module="fitness" href="/fitness">
      <FitnessHome />
    </FirstOpenSetup>
  )
}
