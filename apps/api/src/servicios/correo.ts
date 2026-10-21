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
  return Boolean(entorno.SMTP_HOST && entorno.SMTP_REMITENTE);
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

  transporte = nodemailer.createTransport({
    host: entorno.SMTP_HOST,
    port: entorno.SMTP_PUERTO,
    secure: entorno.SMTP_SEGURIDAD === 'tls',
    ...(entorno.SMTP_USUARIO
      ? { auth: { user: entorno.SMTP_USUARIO, pass: entorno.SMTP_CLAVE ?? '' } }
      : {}),
  });

  return transporte;
}

export interface MensajeQr {
  destinatario: string;
  nombre: string;
  codigoRegistro: string;
  idInstitucional: string;
  nombreSeminario: string;
}

export interface ResultadoEnvio {
  enviado: boolean;
  mensaje: string;
}

async function imagenQr(codigo: string): Promise<string> {
  // La tiperia de qrcode declara la forma con callback; la forma con promesa
  // devuelve directamente el data URL.
  const resultado = await QRCode.toDataURL(codigo, {
    type: 'png',
    errorCorrectionLevel: 'M',
    // Zona de silencio de 4 modulos: facilita la lectura con el celular.
    margin: 4,
    width: 512,
  } as never);
  return resultado as unknown as string;
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
  const imagen = await imagenQr(mensaje.codigoRegistro);

  try {
    await transporteActivo.sendMail({
      from: {
        name: entorno.SMTP_REMITENTE_NOMBRE,
        address: entorno.SMTP_REMITENTE,
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
        'Presenta este codigo (o el codigo QR) en la entrada. No necesitas imprimirlo:',
        'tambien puedes dictarlo al operador.',
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
          <p><img src="${imagen}" alt="Codigo QR de registro" width="220" height="220" /></p>
          <p style="color: #64748b; font-size: 13px;">
            ID institucional: ${escapar(mensaje.idInstitucional)}
          </p>
          <p style="color: #64748b; font-size: 12px;">
            Este mensaje contiene informacion personal asociada a tu inscripcion.
            Si no solicitaste esta informacion, contacta a la coordinacion del seminario.
          </p>
        </div>
      `,
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
