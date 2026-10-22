import nodemailer, { type Transporter } from 'nodemailer';
import QRCode from 'qrcode';
import { cargarEntorno } from '../config/entorno.js';
import { logger } from '../config/log.js';

/**
 * Envio de correo con el codigo de registro y el QR de cada asistente.
 *
 * El servicio es opcional: si no hay SMTP configurado, el sistema lo informa y
 * el administrador puede descargar la carta de QR en PDF para entregarla a mano.
 * Nunca se guarda la contrasa del correo en la base de datos.
 */

let transporte: Transporter | null = null;
let transporteInicializado = false;

export function correoConfigurado(): boolean {
  const entorno = cargarEntorno();
  return Boolean(entorno.SMTP_HOST && (entorno.SMTP_REMITENTE || entorno.SMTP_USUARIO));
}

/**
 * Restablece el singleton del transporte para que la proxima llamada
 * lo inicialice de nuevo. Util cuando cambian las variables de entorno
 * en tiempo de ejecucion (p. ej., tras un recarga en desarrollo).
 */
export function resetearTransporte(): void {
  transporte = null;
  transporteInicializado = false;
}

function obtenerTransporte(): Transporter | null {
  if (transporteInicializado) return transporte;
  transporteInicializado = true;

  const entorno = cargarEntorno();
  if (!entorno.SMTP_HOST) {
    logger.warn(
      'SMTP no configurado: el envio de QR por correo no estara disponible. ' +
        'Use la descarga de la carta de QR en PDF.',
    );
    return null;
  }

  // Gmail y otros proveedores que exigen autenticacion requieren que el
  // campo "from" use la misma direccion que SMTP_USUARIO. Si SMTP_REMITENTE
  // no coincide, el envio falla con "Sender address rejected". Se usa el
  // usuario como remitente cuando el remitente configurado parece un dominio
  // local (sin punto real) o cuando es el valor por defecto de desarrollo.
  const remitenteEfectivo =
    entorno.SMTP_REMITENTE && !entorno.SMTP_REMITENTE.endsWith('.local')
      ? entorno.SMTP_REMITENTE
      : (entorno.SMTP_USUARIO ?? entorno.SMTP_REMITENTE);

  transporte = nodemailer.createTransport({
    host: entorno.SMTP_HOST,
    port: entorno.SMTP_PUERTO,
    secure: entorno.SMTP_SEGURIDAD === 'tls',
    ...(entorno.SMTP_USUARIO
      ? { auth: { user: entorno.SMTP_USUARIO, pass: entorno.SMTP_CLAVE ?? '' } }
      : {}),
  }) as Transporter;

  // Adjuntamos el remitente efectivo al objeto de transporte para usarlo
  // en enviarQrPorCorreo sin volver a leer el entorno.
  (transporte as Transporter & { _remitenteEfectivo?: string })._remitenteEfectivo =
    remitenteEfectivo;

  return transporte;
}

export interface MensajeQr {
  destinatario: string;
  nombre: string;
  codigoRegistro: string;
  idInstitucional: string;
  nombreSeminario: string;
  pdfEscarapela?: Buffer | Uint8Array;
}

export interface ResultadoEnvio {
  enviado: boolean;
  mensaje: string;
}

async function imagenQrBuffer(codigo: string): Promise<Buffer> {
  const buffer = await QRCode.toBuffer(codigo, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 512,
  });
  return buffer;
}

export async function enviarQrPorCorreo(mensaje: MensajeQr): Promise<ResultadoEnvio> {
  const transporteActivo = obtenerTransporte();
  if (!transporteActivo) {
    return {
      enviado: false,
      mensaje:
        'No hay servidor de correo configurado. Descargue la carta de QR en PDF para entregarla a mano.',
    };
  }

  const entorno = cargarEntorno();
  const remitenteEfectivo =
    (transporteActivo as Transporter & { _remitenteEfectivo?: string })._remitenteEfectivo ??
    entorno.SMTP_REMITENTE;
  const bufferQr = await imagenQrBuffer(mensaje.codigoRegistro);

  try {
    await transporteActivo.sendMail({
      from: {
        name: entorno.SMTP_REMITENTE_NOMBRE,
        address: remitenteEfectivo,
      },
      to: mensaje.destinatario,
      subject: `Tu codigo de registro para ${mensaje.nombreSeminario}`,
      text: [
        `Hola ${mensaje.nombre},`,
        '',
        `Tu codigo de registro para el seminario "${mensaje.nombreSeminario}" es:`,
        `    ${mensaje.codigoRegistro}`,
        '',
        `ID institucional: ${mensaje.idInstitucional}`,
        '',
        'Adjuntamos tu escarapela / carnet oficial en formato PDF para el ingreso.',
        'Tambien puedes presentar el codigo QR de este mensaje o dictar tu codigo al operador.',
        '',
        'Este mensaje contiene informacion personal asociada a tu inscripcion.',
      ].join('\n'),
      html: `
        <div style="font-family: Montserrat, Arial, sans-serif; color: #141a1f; max-width: 520px;">
          <h1 style="font-size: 20px; color: #1d31d4;">${escapar(mensaje.nombreSeminario)}</h1>
          <p>Hola ${escapar(mensaje.nombre)},</p>
          <p>Tu codigo de registro es:</p>
          <p style="font-size: 32px; font-weight: 700; letter-spacing: 4px; color: #1d31d4; margin: 16px 0;">
            ${escapar(mensaje.codigoRegistro)}
          </p>
          <p><img src="cid:codigo_qr" alt="Codigo QR de registro" width="220" height="220" style="display: block; border-radius: 8px;" /></p>
          <p style="color: #64748b; font-size: 13px;">
            ID institucional: ${escapar(mensaje.idInstitucional)}
          </p>
          <p style="background: #eef2ff; border-left: 4px solid #1d31d4; padding: 10px 14px; margin: 16px 0; font-size: 13px; color: #1e1b4b; border-radius: 4px;">
            <strong>Escarapela adjunta:</strong> Hemos adjuntado tu carnet / escarapela en formato PDF listo para descargar o imprimir.
          </p>
          <p style="color: #64748b; font-size: 12px;">
            Este mensaje contiene informacion personal asociada a tu inscripcion.
            Si no solicitaste esta informacion, contacta a la coordinacion del seminario.
          </p>
        </div>
      `,
      attachments: [
        {
          filename: `qr-${mensaje.codigoRegistro}.png`,
          content: bufferQr,
          cid: 'codigo_qr', // Content-ID referenciado en el src del img
        },
        ...(mensaje.pdfEscarapela
          ? [
              {
                filename: `escarapela-${mensaje.idInstitucional}.pdf`,
                content: Buffer.from(mensaje.pdfEscarapela),
                contentType: 'application/pdf',
              },
            ]
          : []),
      ],
    });
    return { enviado: true, mensaje: 'Correo enviado correctamente' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'No se pudo enviar el correo con el codigo de registro',
    );
    return {
      enviado: false,
      mensaje:
        error instanceof Error
          ? `No se pudo enviar el correo: ${error.message}`
          : 'No se pudo enviar el correo',
    };
  }
}

function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
