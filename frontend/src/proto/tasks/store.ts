"use client"

import { createStore } from "../lib/store"
import { seedTasks } from "./data"

/** The M2 Tasks mock store (ADR-0009). Mutate only through ./actions. */
export const tasksStore = createStore("tasks", seedTasks)
