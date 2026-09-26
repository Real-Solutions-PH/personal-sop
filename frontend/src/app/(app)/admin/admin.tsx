"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Suspense, useEffect } from "react"

import { type UserPublic, UsersService } from "@/client"
import AddUser from "@/components/Admin/AddUser"
import { columns, type UserTableData } from "@/components/Admin/columns"
import RolePermissionsManager from "@/components/Admin/RolePermissionsManager"
import { DataTable } from "@/components/Common/DataTable"
import PendingUsers from "@/components/Pending/PendingUsers"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"

function getUsersQueryOptions() {
  return {
    queryFn: () => UsersService.readUsers({ skip: 0, limit: 100 }),
    queryKey: ["users"],
  }
}

function UsersTableContent() {
  const { user: currentUser } = useAuth()
  const { data: users } = useSuspenseQuery(getUsersQueryOptions())

  const tableData: UserTableData[] = users.data.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return <DataTable columns={columns} data={tableData} />
}

function UsersTable() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <UsersTableContent />
    </Suspense>
  )
}

export default function Admin() {
  const router = useRouter()
  const { user } = useAuth()

  useEffect(() => {
    if (user && !user.is_superuser) {
      router.replace("/")
    }
  }, [user, router])

  // Wait for the current-user query to resolve before rendering anything that
  // calls superuser-only endpoints (readUsers, /rbac). Rendering the table
  // before the guard resolves fires readUsers for a normal user mid-load, which
  // the backend answers with 403.
  if (!user) return <PendingUsers />
  if (!user.is_superuser) return null

  return (
    <Tabs defaultValue="users" className="flex flex-col gap-6">
      <TabsList>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="roles">Roles &amp; permissions</TabsTrigger>
      </TabsList>

      <TabsContent value="users" className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Users</h1>
            <p className="text-muted-foreground">
              Manage user accounts and permissions
            </p>
          </div>
          <AddUser />
        </div>
        <UsersTable />
      </TabsContent>

      <TabsContent value="roles">
        <RolePermissionsManager />
      </TabsContent>
    </Tabs>
  )
}
