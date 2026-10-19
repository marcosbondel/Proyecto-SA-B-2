# ==============================================================================
# Dónde vive el estado de Terraform
#
# Hasta ahora el estado era un `terraform.tfstate` local, y `.gitignore` lo
# excluye (líneas 103-104). Eso significaba que el estado existía en el disco de
# la persona que hizo el último `apply` y en ningún otro lugar: nadie más podía
# planificar sin arriesgarse a recrear lo que ya estaba corriendo, y un
# `apply` desde el pipeline era imposible. El 2026-10-06 se comprobó que en GCP
# no existía nada de lo que el módulo declara y que tampoco existía el estado:
# las dos cosas a la vez, porque son la misma cosa.
#
# La configuración es **parcial** a propósito: el nombre del bucket depende del
# proyecto y no puede estar fijo en un archivo del repositorio. Se completa al
# inicializar:
#
#   terraform init -backend-config=backend.hcl        # recomendado
#   terraform init -backend-config="bucket=<bucket>"  # equivalente
#
# `backend.hcl` está en `.gitignore` porque el nombre del bucket depende del
# proyecto; la plantilla `backend.hcl.example` sí se commitea.
#
# El bucket es el único recurso que no puede crear este módulo — necesitaría
# existir antes de guardar el estado que lo crea. Lo crea el submódulo
# `bootstrap/`, que corre una vez con estado local y declara ese bucket como
# código, para que ni siquiera el arranque sea un comando recordado de memoria.
# ==============================================================================

terraform {
  backend "gcs" {
    prefix = "bank-usac/gcp"
  }
}
