"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PermissionsService, RbacService, RolesService } from "@/client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

// Grant/revoke the permissions attached to a role. Backend-gated to superusers
// (like the rest of /admin). Mutations invalidate the role's permission set AND
// every user's effective permissions, since a role change reaches every user
// holding that role.
const RolePermissionsManager = () => {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [roleId, setRoleId] = useState<string | undefined>()

  const { data: roles, isPending: rolesPending } = useQuery({
    queryKey: ["roles"],
    queryFn: () => RolesService.readRoles(),
  })

  const { data: allPermissions, isPending: permissionsPending } = useQuery({
    queryKey: ["permissions"],
    queryFn: () => PermissionsService.readPermissions({ limit: 200 }),
  })

  const rolePermsKey = ["rolePermissions", roleId]
  const { data: rolePerms, isPending: rolePermsPending } = useQuery({
    queryKey: rolePermsKey,
    queryFn: () => RbacService.readRolePermissions({ roleId: roleId! }),
    enabled: !!roleId,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: rolePermsKey })
    // A role's permission set changes the effective permissions of every user
    // assigned that role — invalidate all cached user-permission queries.
    queryClient.invalidateQueries({ queryKey: ["userPermissions"] })
  }

  const grant = useMutation({
    mutationFn: (permissionId: string) =>
      RbacService.addPermission({ roleId: roleId!, permissionId }),
    onSuccess: () => showSuccessToast("Permission granted"),
    onError: handleError.bind(showErrorToast),
    onSettled: invalidate,
  })

  const revoke = useMutation({
    mutationFn: (permissionId: string) =>
      RbacService.removePermission({ roleId: roleId!, permissionId }),
    onSuccess: () => showSuccessToast("Permission revoked"),
    onError: handleError.bind(showErrorToast),
    onSettled: invalidate,
  })

  const grantedIds = new Set(rolePerms?.data.map((p) => p.id))
  const busy = grant.isPending || revoke.isPending

  const toggle = (permissionId: string, checked: boolean) => {
    if (checked) grant.mutate(permissionId)
    else revoke.mutate(permissionId)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles &amp; permissions</CardTitle>
        <CardDescription>
          Grant or revoke the permissions attached to a role. Changes apply to
          every user holding that role. Note: the default grants for the seeded
          roles are re-applied whenever the server restarts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rolesPending ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="role-select">Role</Label>
            <Select value={roleId} onValueChange={setRoleId}>
              <SelectTrigger id="role-select" className="w-64">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {roles?.data.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {roleId &&
          (permissionsPending || rolePermsPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {allPermissions?.data.map((perm) => (
                <label
                  key={perm.id}
                  htmlFor={`perm-${perm.id}`}
                  className="flex items-center gap-3 rounded-md border p-2.5 text-sm"
                >
                  <Checkbox
                    id={`perm-${perm.id}`}
                    checked={grantedIds.has(perm.id)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      toggle(perm.id, checked === true)
                    }
                  />
                  <span className="font-mono text-xs">{perm.name}</span>
                  {perm.description && (
                    <span className="text-muted-foreground">
                      {perm.description}
                    </span>
                  )}
                </label>
              ))}
            </div>
          ))}
      </CardContent>
    </Card>
  )
}

export default RolePermissionsManager
