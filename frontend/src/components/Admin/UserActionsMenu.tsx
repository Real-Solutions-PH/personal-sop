"use client"

import { EllipsisVertical } from "lucide-react"
import { useState } from "react"

import type { UserPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import useAuth from "@/hooks/useAuth"
import DeleteUser from "./DeleteUser"
import EditUser from "./EditUser"
import ManageRoles from "./ManageRoles"

interface UserActionsMenuProps {
  user: UserPublic
}

export const UserActionsMenu = ({ user }: UserActionsMenuProps) => {
  const [open, setOpen] = useState(false)
  const { user: currentUser } = useAuth()

  // Editing or deleting your own account from the admin table is disallowed
  // (self-edit lives in Settings; self-delete is a foot-gun). Viewing/managing
  // your own roles stays available — it cannot lock you out, since the
  // is_superuser flag that grants admin access is independent of RBAC roles.
  const isCurrentUser = user.id === currentUser?.id

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!isCurrentUser && (
          <EditUser user={user} onSuccess={() => setOpen(false)} />
        )}
        <ManageRoles user={user} />
        {!isCurrentUser && (
          <DeleteUser id={user.id} onSuccess={() => setOpen(false)} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
