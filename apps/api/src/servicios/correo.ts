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
  /** Datos del evento que se muestran en el pie del correo. */
  lugar?: string | null;
  fecha?: string | null;
  contacto?: string | null;
  facultad?: string | null;
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


/**
 * Arma el asunto, la version de texto y la version HTML del correo con la
 * credencial. Se separa del envio para poder verificarlo en las pruebas.
 */
export function componerCorreo(mensaje: MensajeQr): {
  asunto: string;
  texto: string;
  html: string;
} {
  return {
    asunto: `Credencial de asistencia - ${mensaje.nombreSeminario}`,
    texto: [
        `Estimado(a) ${mensaje.nombre}:`,
        '',
        `Su inscripcion al ${mensaje.nombreSeminario} quedo registrada. Este mensaje contiene su credencial de asistencia, con la que se controla el ingreso al seminario.`,
        '',
        `Codigo de registro: ${mensaje.codigoRegistro}`,
        `ID institucional: ${mensaje.idInstitucional}`,
        '',
        'SU CREDENCIAL CONTROLA LA ASISTENCIA',
        '1. En el ingreso de cada jornada presente este codigo o el codigo QR: con el se registra su asistencia.',
        '2. Lleve la escarapela adjunta (impresa o en el celular). Es obligatoria para entrar y para recibir el refrigerio y el souvenir.',
        '3. Registre la salida al terminar cada jornada. Sin ese registro no se emite el certificado de asistencia.',
        '',
        'El codigo es personal e intransferible.',
        '',
        [mensaje.lugar, mensaje.fecha].filter(Boolean).join(' - '),
        mensaje.contacto ? `Informacion: ${mensaje.contacto}` : null,
        'Universidad Cooperativa de Colombia',
        '',
        'Este mensaje contiene informacion personal asociada a su inscripcion. Si no solicito esta informacion, comuniquese con la coordinacion del seminario.',
      ]
        .filter((linea): linea is string => linea !== null)
        .join('\n'),
    html: `
        <div style="margin:0;padding:0;background:#EFEFEF;font-family:Montserrat,Arial,Helvetica,sans-serif;color:#141a1f;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td align="center" style="padding:24px 12px;">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-collapse:collapse;">
                  <tr>
                    <td style="background:#132740;padding:28px 32px;">
                      <p style="margin:0;color:#00ACC9;font-size:11px;letter-spacing:2px;text-transform:uppercase;">
                        Universidad Cooperativa de Colombia
                      </p>
                      <h1 style="margin:8px 0 0;color:#ffffff;font-size:21px;line-height:1.3;font-weight:700;">
                        ${escapar(mensaje.nombreSeminario)}
                      </h1>
                      ${pieEvento(
                        mensaje.lugar ?? null,
                        mensaje.fecha ?? null,
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td style="height:4px;background:#00ACC9;font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                  <tr>
                    <td style="padding:28px 32px 8px;">
                      <p style="margin:0 0 12px;font-size:15px;">
                        Estimado(a) <strong>${escapar(mensaje.nombre)}</strong>:
                      </p>
                      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3d3d3d;">
                        Su inscripcion al <strong>${escapar(mensaje.nombreSeminario)}</strong> quedo
                        registrada. Este mensaje contiene su <strong>credencial de asistencia</strong>,
                        con la que se controla el ingreso al seminario.
                      </p>

                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                        <tr>
                          <td align="center" style="border:1px solid #d8dee1;background:#f8f9f9;padding:20px;">
                            <p style="margin:0;color:#5F5E5E;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">
                              Codigo de registro
                            </p>
                            <p style="margin:8px 0 0;color:#132740;font-size:34px;letter-spacing:8px;font-weight:700;font-family:'Courier New',monospace;">
                              ${escapar(mensaje.codigoRegistro)}
                            </p>
                            <p style="margin:10px 0 0;color:#5F5E5E;font-size:12px;">
                              ID institucional: ${escapar(mensaje.idInstitucional)}
                            </p>
                          </td>
                        </tr>
                      </table>

                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                        <tr>
                          <td align="center" style="padding:20px 0 4px;">
                            <img src="cid:codigo_qr" alt="Codigo QR de registro" width="200" height="200" style="display:block;border:1px solid #d8dee1;padding:8px;background:#ffffff;" />
                            <p style="margin:8px 0 0;color:#5F5E5E;font-size:11px;">
                              Presente este codigo o el QR en el ingreso
                            </p>
                          </td>
                        </tr>
                      </table>

                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#ECFCFE;border-left:4px solid #00ACC9;">
                        <tr>
                          <td style="padding:16px 18px;">
                            <p style="margin:0 0 10px;color:#132740;font-size:14px;font-weight:700;">
                              Su credencial controla la asistencia
                            </p>
                            <p style="margin:0 0 8px;color:#3d3d3d;font-size:13px;line-height:1.55;">
                              <strong>1. En el ingreso de cada jornada</strong> presente este codigo o el
                              codigo QR: con el se registra su asistencia.
                            </p>
                            <p style="margin:0 0 8px;color:#3d3d3d;font-size:13px;line-height:1.55;">
                              <strong>2. Lleve la escarapela adjunta</strong> (impresa o en el celular).
                              Es <strong>obligatoria para entrar</strong> y para recibir el refrigerio y el
                              souvenir.
                            </p>
                            <p style="margin:0;color:#3d3d3d;font-size:13px;line-height:1.55;">
                              <strong>3. Registre la salida</strong> al terminar cada jornada. Sin ese
                              registro no se emite el certificado de asistencia.
                            </p>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:16px 0 0;color:#5F5E5E;font-size:12px;line-height:1.6;">
                        El codigo es personal e intransferible. Si no solicito esta informacion,
                        comuniquese con la coordinacion del seminario.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 32px 24px;">
                      <p style="margin:0;color:#5F5E5E;font-size:12px;line-height:1.6;">
                        ${escapar(mensaje.contacto ? `Informacion: ${mensaje.contacto}` : 'Informacion: coordinacion del seminario')}
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#132740;padding:16px 32px;">
                      <p style="margin:0;color:#ffffff;font-size:11px;">
                        Universidad Cooperativa de Colombia${mensaje.facultad ? ` - ${escapar(mensaje.facultad)}` : ''}
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>
      `,
  };
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
  const correo = componerCorreo(mensaje);

  try {
    await transporteActivo.sendMail({
      from: {
        name: entorno.SMTP_REMITENTE_NOMBRE,
        address: remitenteEfectivo,
      },
      to: mensaje.destinatario,
      subject: correo.asunto,
      text: correo.texto,
      html: correo.html,
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

/** Pie del encabezado con el lugar y la fecha del evento. */
function pieEvento(lugar: string | null, fecha: string | null): string {
  const partes = [lugar, fecha].filter((valor): valor is string => Boolean(valor));
  if (partes.length === 0) return '';
  return `<p style="margin:8px 0 0;color:#9ec7d1;font-size:12px;">${escapar(partes.join(' - '))}</p>`;
}
