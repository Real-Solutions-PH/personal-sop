"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Shield, X } from "lucide-react"
import { useState } from "react"

import { RbacService, RolesService, type UserPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

interface ManageRolesProps {
  user: UserPublic
}

// Per-user role management, opened from the user row's actions menu. Surfaces
// the user's assigned roles and their effective (role-granted) permissions, and
// lets a superuser assign/remove roles. The whole /admin surface is already
// superuser-gated, which matches the backend: every /rbac endpoint requires a
// superuser.
const ManageRoles = ({ user }: ManageRolesProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const userPermsKey = ["userPermissions", user.id]

  // enabled: isOpen — never fetch until the dialog is actually opened, so
  // rendering one of these per table row costs nothing until used.
  const { data: userPerms, isPending: permsPending } = useQuery({
    queryKey: userPermsKey,
    queryFn: () => RbacService.readUserPermissions({ userId: user.id }),
    enabled: isOpen,
  })

  const { data: allRoles, isPending: rolesPending } = useQuery({
    queryKey: ["roles"],
    queryFn: () => RolesService.readRoles(),
    enabled: isOpen,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: userPermsKey })

  const assign = useMutation({
    mutationFn: (roleId: string) =>
      RbacService.assignRole({ userId: user.id, roleId }),
    onSuccess: () => showSuccessToast("Role assigned"),
    onError: handleError.bind(showErrorToast),
    onSettled: invalidate,
  })

  const remove = useMutation({
    mutationFn: (roleId: string) =>
      RbacService.removeRole({ userId: user.id, roleId }),
    onSuccess: () => showSuccessToast("Role removed"),
    onError: handleError.bind(showErrorToast),
    onSettled: invalidate,
  })

  const assignedIds = new Set(userPerms?.roles.map((r) => r.id))
  const availableRoles =
    allRoles?.data.filter((r) => !assignedIds.has(r.id)) ?? []
  const loading = permsPending || rolesPending
  const busy = assign.isPending || remove.isPending

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuItem
        onSelect={(e) => e.preventDefault()}
        onClick={() => setIsOpen(true)}
      >
        <Shield />
        Manage Roles
      </DropdownMenuItem>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Roles</DialogTitle>
          <DialogDescription>
            Assign or remove roles for {user.email}. The permissions below are
            the effective set granted by the assigned roles.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col gap-3 py-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-5 py-2">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Assigned roles</h3>
              {userPerms?.roles.length ? (
                <div className="flex flex-wrap gap-2">
                  {userPerms.roles.map((role) => (
                    <Badge
                      key={role.id}
                      variant="secondary"
                      className="gap-1 pr-1"
                    >
                      {role.name}
                      <button
                        type="button"
                        aria-label={`Remove ${role.name}`}
                        disabled={busy}
                        onClick={() => remove.mutate(role.id)}
                        className="rounded-full p-0.5 hover:bg-muted-foreground/20 disabled:opacity-50"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No roles assigned.
                </p>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Available roles</h3>
              {availableRoles.length ? (
                <div className="flex flex-wrap gap-2">
                  {availableRoles.map((role) => (
                    <Button
                      key={role.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => assign.mutate(role.id)}
                    >
                      + {role.name}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  All roles are assigned.
                </p>
              )}
            </section>

            <Separator />

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                Effective permissions ({userPerms?.permissions.length ?? 0})
              </h3>
              {userPerms?.permissions.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {userPerms.permissions.map((perm) => (
                    <Badge
                      key={perm.id}
                      variant="outline"
                      className="font-mono text-xs"
                    >
                      {perm.name}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No permissions granted.
                </p>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default ManageRoles
