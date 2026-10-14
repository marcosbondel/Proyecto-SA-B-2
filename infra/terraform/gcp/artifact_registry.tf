# ==============================================================================
# Artifact Registry — el repositorio al que el pipeline empuja las imágenes
#
# Cierra TD-079. Hasta ahora `bank-images` se creaba a mano con
# `gcloud artifacts repositories create` durante el arranque, y la variable de
# repositorio ARTIFACT_REPO lo nombraba de memoria. Desde un proyecto vacío eso
# significaba que `terraform apply` producía la red, las cinco máquinas de base
# de datos y el clúster, y el primer `docker push` fallaba porque no había
# dónde empujar.
#
# Es un recurso aditivo: si el repositorio ya existe en el proyecto,
# `terraform import google_artifact_registry_repository.images \
#   projects/<proyecto>/locations/<region>/repositories/<nombre>`
# lo adopta sin recrearlo, así que nada de lo que esté corriendo tiene que
# detenerse.
# ==============================================================================

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.artifact_repo
  description   = "Imágenes de Bank USAC publicadas por release.yml y cd.yml"
  format        = "DOCKER"

  labels = {
    app = "bank-usac"
  }

  # El enunciado pide dimensionar para no agotar los créditos (§4.2,
  # Consideraciones de costo). Cada push de `cd.yml` a `develop` deja siete
  # imágenes etiquetadas `dev-<sha>` que nadie vuelve a desplegar; sin esta
  # política el repositorio crece una copia del sistema por commit. Las
  # versiones publicadas por `release.yml` (`v*`) quedan exentas: producción
  # sólo despliega esas y tienen que seguir existiendo.
  cleanup_policies {
    id     = "conservar-versiones-publicadas"
    action = "KEEP"

    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["v"]
    }
  }

  cleanup_policies {
    id     = "borrar-imagenes-de-desarrollo-viejas"
    action = "DELETE"

    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["dev-"]
      older_than   = "604800s" # 7 días, la misma retención que el stack de observabilidad
    }
  }

  cleanup_policies {
    id     = "borrar-capas-sin-etiqueta"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "259200s" # 3 días
    }
  }
}
