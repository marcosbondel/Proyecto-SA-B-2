<script setup lang="ts">
import { ageOn, photoRejection, usernameFrom, validateRegistration } from '../../lib/customer';
import type { FieldErrors } from '../../lib/customer';
import { labelForRole } from '../../lib/navigation';
import type { Role } from '../../lib/navigation';

/**
 * Registration, in the three steps the prototype defines.
 *
 * The same component serves two audiences, which is why `mode` exists rather
 * than two near-identical forms: `self` is a person creating their own account
 * from the public zone — the role is fixed to `CLIENTE`, because a form that
 * let an anonymous caller pick `ADMINISTRADOR` would be an open door — and
 * `staff` is a teller or administrator creating one from inside, where choosing
 * the role is the point. The Gateway checks neither; Customer Service does.
 *
 * Splitting it in three is the prototype's decision (`show.reg1`–`show.reg3`)
 * and a good one: the identity photo has its own failure modes and deserves a
 * step where it is the only thing that can go wrong.
 *
 * What this component refuses to do is call a `202` a registration. The reply
 * says *accepted*, and until the audit trail or the activation email says
 * otherwise, that is exactly what the screen says (criterion 8).
 */
const props = withDefaults(defineProps<{ mode?: 'self' | 'staff' }>(), { mode: 'self' });

const api = useGatewayApi();

const {
  state: outcomeState,
  message: outcomeMessage,
  correlationId,
  accepted: acceptedCommand,
  isSending,
  canWatch,
  run,
  reset: resetOutcome,
} = useCustomerOutcome();

const STEPS = ['Datos personales', 'Documento', 'Confirmación'] as const;

/** Which fields belong to which step, so a step only blocks on its own errors. */
const STEP_FIELDS: Readonly<Record<number, readonly string[]>> = {
  1: ['fullName', 'dateOfBirth', 'address', 'email'],
  2: ['identityDocument', 'photo'],
  3: ['credential', 'credentialConfirmation', 'terms'],
};

const step = ref(1);

const fields = reactive({
  fullName: '',
  identityDocument: '',
  email: '',
  dateOfBirth: '',
  address: '',
  credential: '',
  credentialConfirmation: '',
  terms: false,
});

const role = ref<Role>('CLIENTE');
const photo = ref<File | null>(null);
const idempotencyKey = ref('');
const keyField = useTemplateRef<{ renew: () => void }>('keyField');

/** Shown only for steps that have been attempted, never pre-emptively. */
const errors = ref<FieldErrors>({});

const username = computed(() => usernameFrom(fields.fullName));
const age = computed(() => (fields.dateOfBirth === '' ? null : ageOn(fields.dateOfBirth, new Date())));

/** The command was accepted; the form is behind us and only the wait remains. */
const isAccepted = computed(() => acceptedCommand.value !== null);

const roleOptions = (['CLIENTE', 'CAJERO_RECEPTOR', 'ADMINISTRADOR'] as const).map((value) => ({
  value,
  label: labelForRole(value),
}));

const summary = computed(() => [
  { key: 'Nombre completo', value: fields.fullName },
  { key: 'Fecha de nacimiento', value: fields.dateOfBirth },
  { key: 'Dirección', value: fields.address },
  { key: 'Correo electrónico', value: fields.email },
  { key: 'Documento (DPI)', value: fields.identityDocument },
]);

/** Every problem, including the photo, which is not part of the field set. */
function problems(): FieldErrors {
  const found: Record<string, string> = { ...validateRegistration(fields, new Date()) };
  const photoProblem = photoRejection(
    photo.value === null ? null : { type: photo.value.type, size: photo.value.size },
  );

  if (photoProblem !== null) {
    found.photo = photoProblem;
  }

  return found;
}

/** Only the ones this step is responsible for. */
function errorsForStep(all: FieldErrors, current: number): FieldErrors {
  return Object.fromEntries(
    Object.entries(all).filter(([field]) => STEP_FIELDS[current]!.includes(field)),
  );
}

function advance(): void {
  const found = errorsForStep(problems(), step.value);
  errors.value = found;

  if (Object.keys(found).length === 0) {
    step.value += 1;
  }
}

function back(): void {
  errors.value = {};
  step.value -= 1;
}

async function submit(): Promise<void> {
  const found = problems();
  errors.value = found;

  if (Object.keys(found).length > 0) {
    // Send the person back to the step that actually has the problem rather
    // than leaving them on a summary that looks fine.
    const broken = [1, 2].find((candidate) => Object.keys(errorsForStep(found, candidate)).length > 0);

    if (broken !== undefined) {
      step.value = broken;
    }

    return;
  }

  const body = new FormData();

  body.append('fullName', fields.fullName.trim());
  body.append('identityDocument', fields.identityDocument.replace(/\s/g, ''));
  body.append('email', fields.email.trim());
  body.append('dateOfBirth', fields.dateOfBirth);
  body.append('address', fields.address.trim());
  body.append('role', props.mode === 'self' ? 'CLIENTE' : role.value);
  body.append('credential', fields.credential);

  if (photo.value !== null) {
    body.append('photo', photo.value);
  }

  /**
   * The **same** `idempotencyKey` on every attempt, which is the whole point of
   * the key: a retry after a timeout is the same intention, not a second
   * customer. It only changes when `startOver` says a new person is being
   * registered.
   */
  await run(() =>
    api.call<{ customerId: string; correlationId: string }>('/api/customers', {
      method: 'POST',
      body,
      idempotencyKey: idempotencyKey.value,
    }),
  );
}

/** A new intention: a different person, a new key. */
function startOver(): void {
  resetOutcome();
  keyField.value?.renew();
  Object.assign(fields, {
    fullName: '',
    identityDocument: '',
    email: '',
    dateOfBirth: '',
    address: '',
    credential: '',
    credentialConfirmation: '',
    terms: false,
  });
  photo.value = null;
  role.value = 'CLIENTE';
  errors.value = {};
  step.value = 1;
}
</script>

<template>
  <UCard>
    <!-- show.regSent — accepted, and honest about what that means. -->
    <div v-if="isAccepted" class="flex flex-col gap-4 text-center" data-testid="registration-accepted">
      <div
        class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#E4E4E8] text-[22px] font-bold text-[#0B0C10]"
        aria-hidden="true"
      >✓</div>

      <div>
        <h2 class="text-[22px] font-bold leading-[30px]">Registro enviado</h2>
        <p class="mt-2 text-[15px] leading-[22px] text-[#5A5B63]">
          Enviamos un correo a
          <strong class="text-[#23242A]">{{ fields.email }}</strong>
          con un enlace de activación. La cuenta queda activa cuando se abra ese enlace, y no
          antes: sin activación no se puede iniciar sesión.
        </p>
        <p class="mt-2 text-[13px] leading-[18px] text-[#75767F]">
          El usuario será
          <span
            class="font-semibold text-[#23242A]"
            style="font-variant-numeric: tabular-nums lining-nums"
          >{{ username }}</span>
          — si ya existe, el sistema le añadirá un sufijo.
        </p>
      </div>

      <SharedAsyncStateAlert
        :state="outcomeState === 'IDLE' ? 'PENDING' : outcomeState"
        :message="outcomeMessage"
        :correlation-id="correlationId"
      />

      <p v-if="!canWatch" class="text-[12px] leading-[18px] text-[#75767F]">
        El rastro de auditoría solo puede consultarlo un administrador (decisión D-06), así que
        esta pantalla no puede confirmar el desenlace por sí sola. Guarda el identificador de
        correlación: con él, un administrador puede decir exactamente qué ocurrió.
      </p>

      <div class="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <UButton
          v-if="acceptedCommand?.customerId"
          variant="outline"
          color="neutral"
          :to="`/clientes/${acceptedCommand.customerId}`"
        >Ver el cliente</UButton>
        <UButton v-if="props.mode === 'staff'" color="primary" @click="startOver">
          Registrar otro
        </UButton>
        <UButton v-else color="primary" to="/login">Ir a iniciar sesión</UButton>
      </div>
    </div>

    <!-- show.reg1 – show.reg3 -->
    <form v-else class="flex flex-col gap-6" @submit.prevent="step === 3 ? submit() : advance()">
      <ol class="flex gap-2" aria-label="Pasos del registro">
        <li v-for="(label, index) in STEPS" :key="label" class="flex-1">
          <div class="h-1 rounded-full" :class="index + 1 <= step ? 'bg-[#17191F]' : 'bg-[#DCDCE0]'" />
          <div
            class="mt-2 text-[12px] font-semibold"
            :class="index + 1 <= step ? 'text-[#23242A]' : 'text-[#A8A9B2]'"
          >{{ label }}</div>
        </li>
      </ol>

      <section v-if="step === 1" class="flex flex-col gap-4">
        <header>
          <h2 class="text-[22px] font-bold leading-[30px]">Datos personales</h2>
          <p class="mt-1 text-[14px] leading-5 text-[#5A5B63]">Paso 1 de 3 · Customer Service</p>
        </header>

        <UFormField label="Nombre completo" name="fullName" :error="errors.fullName">
          <UInput v-model="fields.fullName" placeholder="María Fernanda López García" class="w-full" />
        </UFormField>

        <UFormField
          label="Fecha de nacimiento"
          name="dateOfBirth"
          :error="errors.dateOfBirth"
          :help="age !== null && !errors.dateOfBirth ? `Edad: ${age} años` : undefined"
        >
          <UInput v-model="fields.dateOfBirth" type="date" class="w-full" />
        </UFormField>

        <UFormField label="Dirección" name="address" :error="errors.address">
          <UInput v-model="fields.address" placeholder="12 calle 3-45 zona 1, Guatemala" class="w-full" />
        </UFormField>

        <UFormField label="Correo electrónico" name="email" :error="errors.email">
          <UInput
            v-model="fields.email"
            type="email"
            autocomplete="email"
            placeholder="maria.lopez@correo.com"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="props.mode === 'staff'"
          label="Rol"
          name="role"
          help="Quién será esta persona en el sistema. Un registro público siempre es un cliente."
        >
          <USelect v-model="role" :items="roleOptions" value-key="value" class="w-full" />
        </UFormField>

        <UButton type="submit" color="primary" block size="lg">Continuar</UButton>
      </section>

      <section v-else-if="step === 2" class="flex flex-col gap-4">
        <header>
          <h2 class="text-[22px] font-bold leading-[30px]">Documento de identidad</h2>
          <p class="mt-1 text-[14px] leading-5 text-[#5A5B63]">
            Paso 2 de 3 · La foto del DPI la revisa un cajero
          </p>
        </header>

        <UFormField
          label="Número de DPI (13 dígitos)"
          name="identityDocument"
          :error="errors.identityDocument"
        >
          <UInput
            v-model="fields.identityDocument"
            placeholder="2547 89632 0101"
            class="w-full"
            style="font-variant-numeric: tabular-nums lining-nums"
          />
        </UFormField>

        <CustomerIdentityUpload v-model="photo" />

        <p v-if="errors.photo" class="text-[13px] text-[#B01B1B]">{{ errors.photo }}</p>

        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" size="lg" @click="back">Volver</UButton>
          <UButton type="submit" color="primary" size="lg" class="flex-1 justify-center">
            Continuar
          </UButton>
        </div>
      </section>

      <section v-else class="flex flex-col gap-4">
        <header>
          <h2 class="text-[22px] font-bold leading-[30px]">Confirmación</h2>
          <p class="mt-1 text-[14px] leading-5 text-[#5A5B63]">
            Paso 3 de 3 · Revisa los datos y crea la contraseña
          </p>
        </header>

        <div class="rounded-2xl border border-[#DCDCE0] bg-[#F0F0F2] p-5">
          <div
            v-for="row in summary"
            :key="row.key"
            class="flex justify-between gap-4 border-t border-[#DCDCE0] py-2 first:border-t-0"
          >
            <span class="text-[13px] text-[#75767F]">{{ row.key }}</span>
            <span
              class="text-right text-[13px] font-medium"
              style="font-variant-numeric: tabular-nums lining-nums"
            >{{ row.value }}</span>
          </div>
          <div class="flex justify-between gap-4 border-t border-[#DCDCE0] pt-3">
            <span class="text-[13px] text-[#75767F]">Documento</span>
            <span class="text-[13px] font-medium text-[#1E7A3C]">{{ photo?.name }} cargado</span>
          </div>
        </div>

        <UFormField
          label="Username generado"
          name="username"
          help="Se genera del nombre. Es una previsualización: si ya existe, Customer Service le añade un sufijo."
        >
          <UInput
            :model-value="username"
            readonly
            class="w-full"
            style="font-variant-numeric: tabular-nums lining-nums"
          />
        </UFormField>

        <UFormField label="Contraseña" name="credential" :error="errors.credential">
          <UInput
            v-model="fields.credential"
            type="password"
            autocomplete="new-password"
            placeholder="Mínimo 8 caracteres"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Confirmar contraseña"
          name="credentialConfirmation"
          :error="errors.credentialConfirmation"
        >
          <UInput
            v-model="fields.credentialConfirmation"
            type="password"
            autocomplete="new-password"
            placeholder="Repite la contraseña"
            class="w-full"
          />
        </UFormField>

        <UCheckbox
          v-model="fields.terms"
          label="Acepto los términos y condiciones y el tratamiento de mis datos personales."
        />
        <p v-if="errors.terms" class="text-[13px] text-[#B01B1B]">{{ errors.terms }}</p>

        <SharedAsyncStateAlert
          v-if="outcomeState !== 'IDLE' && outcomeState !== 'PENDING'"
          :state="outcomeState"
          :message="outcomeMessage"
          :correlation-id="correlationId"
        />

        <div class="flex gap-2">
          <UButton variant="outline" color="neutral" size="lg" :disabled="isSending" @click="back">
            Volver
          </UButton>
          <UButton
            type="submit"
            color="primary"
            size="lg"
            class="flex-1 justify-center"
            :loading="isSending"
            :disabled="isSending"
            data-testid="registration-submit"
          >{{ isSending ? 'Enviando…' : 'Crear cuenta' }}</UButton>
        </div>
      </section>

      <!--
        Mounted for the whole form, shown only at the last step: unmounting it
        between steps would mint a new key, and a key that changes when you press
        "Volver" is not an idempotency key at all.
      -->
      <SharedIdempotencyKeyField ref="keyField" v-model="idempotencyKey" :visible="step === 3" />
    </form>
  </UCard>
</template>
