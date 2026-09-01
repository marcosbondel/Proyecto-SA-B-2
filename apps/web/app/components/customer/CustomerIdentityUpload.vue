<script setup lang="ts">
import { formatBytes, photoRejection } from '../../lib/customer';

/**
 * The photo of the identity document, refused locally before it is sent.
 *
 * The four states are the prototype's `up.idle`, `up.loading`, `up.done` and
 * `up.error`. Two of them differ from `bonking.dc.html` in *when* they happen,
 * and the difference is honest rather than cosmetic: the prototype uploads on
 * selection and shows a percentage, while here the bytes travel with the
 * registration itself. So `loading` is the moment the form is being submitted,
 * and there is no percentage to invent.
 *
 * The rejection is local and immediate — no request leaves for a PDF or for
 * eight megabytes. The Gateway refuses both as well, while the upload is still
 * arriving; this is the courtesy, not the control.
 */
const props = defineProps<{ pending?: boolean }>();

const file = defineModel<File | null>({ default: null });

const rejection = ref<string | null>(null);

/**
 * The preview, as an object URL that is always released.
 *
 * A `computed` would mint a new URL on every re-render and leak every previous
 * one — cheap per image, and permanent for as long as the tab lives.
 */
const previewUrl = ref<string | null>(null);

function showPreview(candidate: File | null): void {
  if (previewUrl.value !== null) {
    URL.revokeObjectURL(previewUrl.value);
  }

  previewUrl.value = candidate === null ? null : URL.createObjectURL(candidate);
}

/** What the person actually picked, kept out of the model until it is valid. */
function onChange(chosen: File | File[] | null | undefined): void {
  const candidate = Array.isArray(chosen) ? (chosen[0] ?? null) : (chosen ?? null);

  if (candidate === null) {
    file.value = null;
    rejection.value = null;
    showPreview(null);
    return;
  }

  const problem = photoRejection({ type: candidate.type, size: candidate.size });

  if (problem !== null) {
    // Keeping the model empty is what stops a refused file from being sent by
    // a submit that only checked "is there a file".
    file.value = null;
    rejection.value = problem;
    showPreview(null);
    return;
  }

  rejection.value = null;
  file.value = candidate;
  showPreview(candidate);
}

function clear(): void {
  file.value = null;
  rejection.value = null;
  showPreview(null);
}

onBeforeUnmount(() => showPreview(null));
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="identity-upload">
    <span class="text-[13px] font-medium text-[#5A5B63]">Foto del documento</span>

    <!-- up.done — the file is chosen and can still be changed. -->
    <div
      v-if="file && !props.pending"
      class="rounded-2xl border border-[#DCDCE0] bg-white p-4"
      data-state="done"
    >
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt="Vista previa de la foto del documento"
        class="h-[180px] w-full rounded-xl bg-[#DCDCE0] object-contain"
      >
      <div class="mt-3 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <div class="truncate text-[13px] font-medium">{{ file.name }}</div>
          <div class="text-[12px] text-[#75767F]" style="font-variant-numeric: tabular-nums lining-nums">
            {{ formatBytes(file.size) }} · listo para enviar
          </div>
        </div>
        <UButton size="xs" variant="outline" color="neutral" @click="clear">Cambiar</UButton>
      </div>
    </div>

    <!-- up.loading — the bytes are travelling with the registration. -->
    <div
      v-else-if="file && props.pending"
      class="rounded-2xl border border-[#DCDCE0] bg-white p-5"
      data-state="loading"
    >
      <div class="mb-2 flex justify-between text-[13px] font-medium">
        <span class="truncate">{{ file.name }}</span>
        <span class="text-[#5A5B63]">enviando…</span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-[#E9E9EC]">
        <div class="h-1.5 w-1/3 animate-pulse rounded-full bg-[#17191F]" />
      </div>
      <p class="mt-2 text-[12px] text-[#75767F]">Subiendo… no cierres esta ventana.</p>
    </div>

    <!-- up.idle — nothing chosen yet. -->
    <UFileUpload
      v-else
      accept="image/jpeg,image/png"
      class="min-h-[168px] w-full"
      label="Arrastra la foto del DPI o selecciónala"
      description="JPG o PNG · máximo 5 MB"
      data-state="idle"
      @update:model-value="onChange"
    />

    <!-- up.error — refused here, with the real reason. -->
    <UAlert
      v-if="rejection"
      color="error"
      variant="subtle"
      title="No se pudo usar la imagen"
      :description="rejection"
      data-testid="identity-upload-error"
    />
  </div>
</template>
