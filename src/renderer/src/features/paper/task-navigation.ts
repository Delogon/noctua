export function taskIdAfterCompletion(
  openTasks: ReadonlyArray<{ id: number }>,
  completedTaskId: number
): number | null {
  const currentIndex = openTasks.findIndex((task) => task.id === completedTaskId)
  if (currentIndex === -1) return null

  return openTasks[currentIndex + 1]?.id ?? openTasks[currentIndex - 1]?.id ?? null
}

/** Visibility per status — both off deliberately means: empty list. */
export interface TaskStatusVisibility {
  open: boolean
  done: boolean
}

export function visibleTaskRows<T extends { status: string }>(
  openTasks: readonly T[],
  completedTasks: readonly T[],
  visibility: TaskStatusVisibility
): T[] {
  return [
    ...(visibility.open ? openTasks : []),
    ...(visibility.done ? completedTasks.filter((task) => task.status === 'done') : [])
  ]
}

export function taskIdAfterVisibilityChange(
  visibleTasks: ReadonlyArray<{ id: number }>,
  selectedTaskId: number | null
): number | null {
  if (visibleTasks.some((task) => task.id === selectedTaskId)) return selectedTaskId
  return visibleTasks[0]?.id ?? null
}
