"use client"
import { createStore } from "../lib/store"
import { seedTasks } from "./data"
export const tasksStore = createStore("tasks", seedTasks)
