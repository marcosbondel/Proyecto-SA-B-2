workspace extends c4.dsl {
    name "Bank USAC - C4 L1: actores, banco y sistemas externos; detalle técnico en L2."
    views {
        systemContext bankusac "Contexto_Fase_III" "C4 L1: actores, banco y sistemas externos; detalle técnico en L2." {
            include cliente cajero admin sre bankusac banco resend
            autoLayout lr 900 500
        }
    }
}
