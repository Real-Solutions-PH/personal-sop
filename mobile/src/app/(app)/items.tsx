import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as Crypto from "expo-crypto"
import { useState } from "react"
import { FlatList, Pressable, TextInput, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import * as itemsDb from "@/lib/db/items"
import * as syncQueueDb from "@/lib/db/sync-queue"
import { runSync } from "@/lib/sync"
import { useAuthStore } from "@/stores/auth-store"

export default function ItemsScreen() {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["items"],
    queryFn: () => {
      const items = itemsDb.getLocalItems()
      return { data: items, count: items.length }
    },
  })

  const createItem = useMutation({
    mutationFn: async (input: { title: string; description?: string }) => {
      // expo-crypto's randomUUID works on Hermes, where the global
      // crypto.randomUUID() is undefined and throws.
      const id = Crypto.randomUUID()
      const now = new Date().toISOString()
      const userId = useAuthStore.getState().userId ?? ""

      itemsDb.insertItem({
        id,
        title: input.title,
        description: input.description ?? null,
        owner_id: userId,
        created_at: now,
        updated_at: null,
        is_local: 1,
      })

      syncQueueDb.enqueueSync({
        entity_type: "item",
        entity_id: id,
        action: "create",
        payload: JSON.stringify({
          title: input.title,
          description: input.description,
        }),
      })

      runSync()
      return id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] })
      setTitle("")
      setDescription("")
    },
  })

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      itemsDb.deleteItem(id)
      syncQueueDb.enqueueSync({
        entity_type: "item",
        entity_id: id,
        action: "delete",
        payload: null,
      })
      runSync()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] })
    },
  })

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 p-4">
        <Text className="mb-4 text-2xl font-bold">Items</Text>

        <View className="mb-4 gap-2">
          <TextInput
            className="rounded-md border border-input bg-background px-3 py-2 text-foreground"
            placeholder="Title"
            placeholderTextColor="#888"
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            className="rounded-md border border-input bg-background px-3 py-2 text-foreground"
            placeholder="Description (optional)"
            placeholderTextColor="#888"
            value={description}
            onChangeText={setDescription}
          />
          <Button
            label={createItem.isPending ? "Adding..." : "Add Item"}
            onPress={() => {
              if (!title.trim()) return
              createItem.mutate({
                title: title.trim(),
                description: description.trim() || undefined,
              })
            }}
            disabled={createItem.isPending || !title.trim()}
          />
        </View>

        {isLoading ? (
          <Text className="text-muted-foreground">Loading...</Text>
        ) : (
          <FlatList
            data={data?.data ?? []}
            keyExtractor={(it) => it.id}
            ItemSeparatorComponent={() => <View className="h-px bg-border" />}
            ListEmptyComponent={
              <Text className="text-muted-foreground">No items yet</Text>
            }
            renderItem={({ item }) => (
              <View className="flex-row items-center justify-between py-3">
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-medium">{item.title}</Text>
                    {item.is_local === 1 ? (
                      <Text className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        local
                      </Text>
                    ) : null}
                  </View>
                  {item.description ? (
                    <Text className="text-sm text-muted-foreground">
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => deleteItem.mutate(item.id)}
                  className="ml-2 rounded p-2 active:opacity-60"
                >
                  <Text className="text-sm text-destructive">Delete</Text>
                </Pressable>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  )
}
