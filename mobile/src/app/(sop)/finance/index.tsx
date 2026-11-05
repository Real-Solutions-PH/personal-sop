import { FirstOpenSetup } from "@/prototype/first-open-setup"
import { FinanceHome } from "@/prototype/screens/finance-home"
export default function Page() {
  return (
    <FirstOpenSetup module="finance" href="/finance">
      <FinanceHome />
    </FirstOpenSetup>
  )
}
