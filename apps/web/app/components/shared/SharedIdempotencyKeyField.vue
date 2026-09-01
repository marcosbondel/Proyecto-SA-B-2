<script setup lang="ts">
/**
 * A key that says "this is the same intention", stable across retries.
 *
 * The whole value of an idempotency key is that it does **not** change when
 * somebody presses the button again after a timeout. Regenerating it per
 * request would make every retry a new intention, and the receiving service —
 * which is where deduplication actually happens — would have no way to tell a
 * retry from a second transfer.
 *
 * It changes only when the intention does, which the caller signals with
 * `renew()`. Shown rather than hidden because it is diagnostic: when two
 * transfers appear where one was meant, this is the value that explains it.
 */
const props = withDefaults(defineProps<{ visible?: boolean }>(), { visible: true });

const key = ref(crypto.randomUUID());

const model = defineModel<string>({ default: '' });
model.value = key.value;

/** Call after a success, when the next attempt is genuinely a new intention. */
function renew(): void {
  key.value = crypto.randomUUID();
  model.value = key.value;
}

defineExpose({ renew, key });
</script>

<template>
  <div v-if="props.visible" class="flex flex-col gap-1">
    <span class="text-[11px] uppercase tracking-[0.06em] text-[#75767F]">
      Código de esta operación
    </span>
    <code
      class="break-all font-mono text-[12px] text-[#5A5B63]"
      style="font-variant-numeric: tabular-nums lining-nums"
      data-testid="idempotency-key"
    >{{ key }}</code>
    <span class="text-[12px] text-[#75767F]">
      Se mantiene igual mientras reintentas, para que el sistema reconozca que es la misma operación.
    </span>
  </div>
</template>
