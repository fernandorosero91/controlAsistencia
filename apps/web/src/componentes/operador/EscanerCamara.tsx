import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { Camera, CameraOff } from 'lucide-react';
import { ErrorPeticion } from '../../lib/api';

interface Props {
  abierto: boolean;
  alCerrar: () => void;
  alDetectar: (texto: string) => void;
}

/**
 * Lector dedicado a codigos QR.
 *
 * El QR de la escarapela es un codigo pequeno y de un solo formato, asi que un
 * lector multi-formato (que ademas intenta codigos de barras, Aztec y Data
 * Matrix en cada intento) tarda mucho mas en reconocerlo. Ademas, la libreria
 * espera 500 ms entre intentos: aqui se reduce a 100 ms, que es lo que hace
 * que el operador perciba el escaneo como lento.
 */
const lector = new BrowserQRCodeReader(undefined, {
  delayBetweenScanAttempts: 100,
  delayBetweenScanSuccess: 100,
  tryPlayVideoTimeout: 8000,
});

/** Se pide la camara trasera en una resolucion alta: un QR pequeno se
 * reconoce antes cuanto mas pixeles tiene el cuadro. */
const restriccionesVideo: MediaStreamConstraints = {
  video: {
    facingMode: 'environment',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: false,
};

export function EscanerCamara({ abierto, alCerrar, alDetectar }: Props) {
  const contenedorRef = useRef<HTMLVideoElement | null>(null);
  const controlesRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iniciando, setIniciando] = useState(false);

  const detener = useCallback(() => {
    controlesRef.current?.stop();
    controlesRef.current = null;
  }, []);

  useEffect(() => {
    if (!abierto) {
      detener();
      setError(null);
      return;
    }

    let cancelado = false;
    setIniciando(true);
    setError(null);

    // La camara solo se puede abrir en un contexto seguro (HTTPS o localhost).
    // En una red local sin TLS el operador debe digitar el codigo de 6 caracteres.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setError(
        'Este sitio no usa HTTPS, asi que el navegador no permite abrir la camara. ' +
          'Digite el codigo de 6 caracteres de la escarapela (por ejemplo K7M4D2).',
      );
      setIniciando(false);
      return;
    }

    const iniciar = async () => {
      try {
        const controles = await lector.decodeFromConstraints(
          restriccionesVideo,
          contenedorRef.current ?? undefined,
          (resultado) => {
            if (!resultado) return;
            const texto = resultado.getText().trim();
            if (texto.length > 0) {
              alDetectar(texto);
              detener();
              alCerrar();
            }
          },
        );
        if (cancelado) {
          controles.stop();
          return;
        }
        controlesRef.current = controles;
      } catch (problema) {
        if (cancelado) return;
        const mensaje =
          problema instanceof ErrorPeticion
            ? problema.message
            : 'No se pudo acceder a la camara. Revise los permisos del navegador.';
        setError(mensaje);
      } finally {
        if (!cancelado) setIniciando(false);
      }
    };

    void iniciar();

    return () => {
      cancelado = true;
      detener();
    };
  }, [abierto, alCerrar, alDetectar, detener]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutro-900">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-base font-semibold text-white">Escanear codigo QR</h2>
        <button
          type="button"
          onClick={alCerrar}
          className="boton-compacto text-white hover:bg-white/10"
          aria-label="Cerrar el escaner"
        >
          <CameraOff className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden bg-black">
        <video
          ref={contenedorRef}
          className="h-full w-full object-cover"
          muted
          playsInline
          aria-label="Vista de la camara"
        />
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          <div className="h-48 w-48 rounded-2xl border-4 border-primario-300/90" />
        </div>
      </div>

      <div className="px-4 py-4 text-center">
        {error ? (
          <p className="text-sm text-error-300" role="alert">
            {error}
          </p>
        ) : iniciando ? (
          <p className="flex items-center justify-center gap-2 text-sm text-neutro-300">
            <Camera className="h-4 w-4 animate-pulse" aria-hidden="true" />
            Activando la camara
          </p>
        ) : (
          <p className="text-sm text-neutro-300">
            Encuadre el codigo QR de la escarapela dentro del marco. El codigo tiene 6 caracteres.
          </p>
        )}
      </div>
    </div>
  );
}
