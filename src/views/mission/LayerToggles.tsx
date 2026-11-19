/**
 * Map layer visibility.
 *
 * These are preferences rather than mission state, so the store persists them
 * and a reload comes back with the same map. They write through
 * `setRenderOption`, which is also what keeps hover and selection — which
 * change on every mouse move — out of localStorage.
 */

import { LAYER_TOGGLES } from '@/state/defaults'
import { useRenderOptions, useSetRenderOption } from '@/state/selectors'
import { Toggle } from '@/ui'

export function LayerToggles() {
  const options = useRenderOptions()
  const setOption = useSetRenderOption()

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {LAYER_TOGGLES.map(({ key, label, hint }) => (
        <Toggle
          key={key}
          checked={options[key] === true}
          onChange={(next: boolean) => setOption(key, next)}
          label={label}
          title={hint}
        />
      ))}
    </div>
  )
}
