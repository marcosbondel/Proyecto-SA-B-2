<script setup lang="ts">
/**
 * The `bk` tile — the brand mark, and the one lit object in the interface.
 *
 * Two details make it the prototype's mark rather than a black square with
 * rounded corners: the **notch**, a `clip-path` that cuts the top-left and
 * bottom-right corners at 26%, and a gradient run at 150° rather than straight
 * down, so the light reads as coming from the upper left across a bevel.
 * `docs/DESIGN.md` calls this lacquered rather than flat, and the notch is what
 * stops it looking like every other rounded tile in every other banking app.
 *
 * It lives in one component because both layouts and the error page draw it,
 * and three transcriptions of a `clip-path` polygon is three chances to get one
 * of the six points wrong.
 */
withDefaults(
  defineProps<{
    /** Side of the tile in pixels. The type scales with it. */
    readonly size?: number;
  }>(),
  { size: 34 },
);
</script>

<template>
  <span
    class="grid flex-none place-items-center"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      background: 'linear-gradient(150deg, #3A3D49 0%, #17191F 46%, #0B0C10 100%)',
      clipPath: 'polygon(26% 0, 100% 0, 100% 74%, 74% 100%, 0 100%, 0 26%)',
    }"
    aria-hidden="true"
  >
    <span
      class="font-bold text-white"
      :style="{ fontSize: `${Math.round(size * 0.44)}px`, letterSpacing: '-0.05em' }"
    >bk</span>
  </span>
</template>
