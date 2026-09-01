<script setup lang="ts">
import { IDENTITY_PRESENTATION, updatePayload, validateUpdate } from '../../lib/customer';
import type { FieldErrors, IdentityStatus, UpdateFields } from '../../lib/customer';
import { labelForRole } from '../../lib/navigation';
import type { Role } from '../../lib/navigation';

/**
 * Changing what Customer Service holds about a person.
 *
 * Three fields, because `UpdateCustomerDto` accepts three. The prototype's
 * `show.profile` also edits the email; the Gateway does not, so offering it
 * here would be offering a change that silently never happens. That deviation
 * is recorded in the ticket rather than papered over with a disabled box that
 * nobody can explain.
 *
 * The edit boxes start **empty**, and that is not laziness: an empty box means
 * "leave this alone", which is stated on the screen and enforced in
 * `updatePayload`. What used to be missing was any way to see the current data,
 * so the form was edited blind (TD-020); now the current record is loaded from
 * `GET /api/customers/{id}` and shown read-only above the boxes, without
 * changing the "empty = leave alone" edit model.
 */
const props = defineProps<{ customerId: string }>();

const api = useGatewayApi();

interface CurrentCustomer {
  readonly fullName: string;
  readonly identityDocument: string;
  readonly email: string;
  readonly dateOfBirth: string;
  readonly address: string;
  readonly username: string;
  /**
   * The two closed sets, typed as such, because this card renders them through
   * the project's own words — `labelForRole` and `IDENTITY_PRESENTATION` — and
   * `string` would let a value neither of them has a label for reach a reader.
   */
  readonly role: Role;
  readonly status: string;
  readonly identityStatus: IdentityStatus;
}

const current = ref<CurrentCustomer | null>(null);
const loadError = ref<string | null>(null);

onMounted(async () => {
  const result = await api.call<CurrentCustomer & { outcome: string }>(
    `/api/customers/${props.customerId}`,
  );

  if (result.ok) {
    current.value = result.data;
  } else {
    // A client looking at somebody who is not theirs comes back as a business
    // rejection; the edit boxes still work, there is just nothing to preview.
    loadError.value = result.error.message;
  }
});

const {
  state: outcomeState,
  message: outcomeMessage,
  correlationId,
  isSending,
  canWatch,
  run,
} = useCustomerOutcome();

const fields = reactive<UpdateFields>({ fullName: '', address: '', dateOfBirth: '' });
const idempotencyKey = ref('');
const errors = ref<FieldErrors>({});

const changes = computed(() => updatePayload(fields));
const hasChanges = computed(() => Object.keys(changes.value).length > 0);

async function submit(): Promise<void> {
  const found = validateUpdate(fields, new Date());
  errors.value = found;

  if (Object.keys(found).length > 0) {
    return;
  }

  await run(() =>
    api.call<{ correlationId: string }>(`/api/customers/${props.customerId}`, {
      method: 'PATCH',
      body: changes.value,
      idempotencyKey: idempotencyKey.value,
    }),
  );
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-[20px] font-semibold leading-7">Datos personales</h2>
      <p class="mt-1 text-[13px] leading-5 text-[#5A5B63]">
        Escribe solo lo que quieras cambiar: un campo vacío se deja como está. El correo y el
        usuario no se pueden modificar.
      </p>
    </template>

    <dl
      v-if="current"
      class="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-[#F6F6F7] p-4 text-[13px]"
      data-testid="customer-current"
    >
      <div><dt class="text-[#75767F]">Nombre</dt><dd class="font-medium">{{ current.fullName }}</dd></div>
      <div><dt class="text-[#75767F]">Usuario</dt><dd class="font-medium">{{ current.username }}</dd></div>
      <div><dt class="text-[#75767F]">Correo</dt><dd class="font-medium">{{ current.email }}</dd></div>
      <div><dt class="text-[#75767F]">Documento</dt><dd class="font-medium">{{ current.identityDocument }}</dd></div>
      <div><dt class="text-[#75767F]">Nacimiento</dt><dd class="font-medium">{{ current.dateOfBirth }}</dd></div>
      <div><dt class="text-[#75767F]">Dirección</dt><dd class="font-medium">{{ current.address }}</dd></div>
      <!--
        The words this project already has for these two, rather than the enum.
        Two cards down the same screen writes "Pendiente de revisión"; printing
        `PENDING` here made one page say it both ways.
      -->
      <div><dt class="text-[#75767F]">Rol</dt><dd class="font-medium">{{ labelForRole(current.role) }}</dd></div>
      <div>
        <dt class="text-[#75767F]">Identidad</dt>
        <dd class="font-medium">{{ IDENTITY_PRESENTATION[current.identityStatus].label }}</dd>
      </div>
    </dl>

    <p v-else-if="loadError" class="mb-4 text-[13px] text-[#75767F]">
      No pudimos cargar tus datos actuales. Aun así puedes escribir los cambios.
    </p>

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <UFormField label="Nombre completo" name="fullName" :error="errors.fullName">
        <UInput v-model="fields.fullName" placeholder="Sin cambios" class="w-full" />
      </UFormField>

      <UFormField label="Dirección" name="address" :error="errors.address">
        <UInput v-model="fields.address" placeholder="Sin cambios" class="w-full" />
      </UFormField>

      <UFormField label="Fecha de nacimiento" name="dateOfBirth" :error="errors.dateOfBirth">
        <UInput v-model="fields.dateOfBirth" type="date" class="w-full" />
      </UFormField>

      <p v-if="errors.form" class="text-[13px] text-[#B01B1B]" data-testid="update-form-error">
        {{ errors.form }}
      </p>

      <SharedIdempotencyKeyField v-model="idempotencyKey" />

      <SharedAsyncStateAlert
        v-if="outcomeState !== 'IDLE'"
        :state="outcomeState"
        :message="outcomeMessage"
        :correlation-id="correlationId"
      />

      <p v-if="outcomeState === 'PENDING' && !canWatch" class="text-[12px] leading-[18px] text-[#75767F]">
        Tu sesión no puede consultar el rastro de auditoría — solo un administrador puede —, así
        que el cambio queda aceptado sin confirmación visible. Guarda el código de seguimiento.
      </p>

      <div class="flex justify-end">
        <UButton
          type="submit"
          color="primary"
          :loading="isSending"
          :disabled="isSending || !hasChanges"
          data-testid="update-submit"
        >{{ isSending ? 'Guardando…' : 'Guardar cambios' }}</UButton>
      </div>
    </form>
  </UCard>
</template>
