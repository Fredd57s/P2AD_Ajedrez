import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailTask, EmailStatus } from './entities/email-task.entity';
import * as nodemailer from 'nodemailer';
import { Interval } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    @InjectRepository(EmailTask)
    private readonly emailQueueRepo: Repository<EmailTask>,
  ) {
    // Configuramos Nodemailer con las variables de entorno
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER, 
        pass: process.env.GMAIL_PASS, // Contraseña de aplicación de Gmail (16 letras)
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }

  // =========================================================================
  // 1. MÉTODO DE ENCOLADO (Se usa en los controladores, es de respuesta inmediata)
  // =========================================================================
  async queueEmail(to: string, subject: string, body: string): Promise<void> {
    const task = this.emailQueueRepo.create({
      to,
      subject,
      body,
      status: EmailStatus.PENDING,
    });
    await this.emailQueueRepo.save(task);
    this.logger.log(`Tarea de correo registrada en BD para: ${to}`);
  }

  // =========================================================================
  // 2. EL WORKER ASÍNCRONO (Revisa la base de datos cada 10 segundos)
  // =========================================================================
  @Interval(10000)
  async processEmailQueue() {
    // Buscamos correos pendientes, o los fallidos que tengan menos de 3 reintentos
    const tasks = await this.emailQueueRepo.createQueryBuilder('email')
      .where('email.status = :pending OR (email.status = :failed AND email.retries < 3)', { 
        pending: EmailStatus.PENDING, 
        failed: EmailStatus.FAILED 
      })
      .take(5) // Límite de 5 correos por ciclo para evitar bloqueos por spam
      .getMany();

    if (tasks.length === 0) return;

    for (const task of tasks) {
      try {
        // Bloqueamos la tarea pasándola a PROCESSING
        task.status = EmailStatus.PROCESSING;
        await this.emailQueueRepo.save(task);

        // Disparamos el envío a Gmail
        await this.transporter.sendMail({
          from: `"Nexus Board Security" <${process.env.GMAIL_USER}>`,
          to: task.to,
          subject: task.subject,
          html: task.body,
        });

        // Si sale bien, cerramos la tarea
        task.status = EmailStatus.SENT;
        this.logger.log(`[Worker] Correo enviado exitosamente a ${task.to}`);
      } catch (error: any) {
        // Si hay error (ej. sin internet, credenciales inválidas), aumentamos retries
        task.status = EmailStatus.FAILED;
        task.retries += 1;
        task.errorMessage = error.message;
        this.logger.error(`[Worker] Fallo al enviar a ${task.to}: ${error.message}`);
      } finally {
        await this.emailQueueRepo.save(task);
      }
    }
  }

  // Añade esto en tu MailService
  async sendPaymentReceipt(email: string, transactionId: string, amount: string, method: string) {
    const htmlTemplate = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
        <h2 style="color: #00d2ff; text-align: center;">¡Inscripción Exitosa! 🏆</h2>
        <p>Tu pago para el torneo de Chess AI ha sido procesado correctamente.</p>
        <div style="background: #f9f9f9; padding: 15px; border-radius: 8px;">
          <p><strong>Método de pago:</strong> ${method} (Sandbox)</p>
          <p><strong>ID de Transacción:</strong> ${transactionId}</p>
          <p><strong>Total pagado:</strong> $${amount}</p>
        </div>
        <p style="text-align: center; margin-top: 20px;">
          ¡Prepárate para la competencia! Revisa las llaves en la aplicación.
        </p>
      </div>
    `;

    await this.transporter.sendMail({
      from: '"Chess AI Torneos" <tu-correo@gmail.com>',
      to: email,
      subject: 'Recibo de Inscripción al Torneo 🧾',
      html: htmlTemplate,
    });
  }

  // 👇 ESCUCHA EL EVENTO Y ENVÍA EL CORREO
  @OnEvent('tournament.payment.approved')
  async handleTournamentPayment(payload: { email: string, orderId: string, amount: string }) {
    console.log(`[MailService] Preparando recibo de torneo para: ${payload.email}`);
    try {
      // Usa tu función existente de enviar recibos
      await this.sendPaymentReceipt(payload.email, payload.orderId, payload.amount, 'PayPal');
      console.log(`[MailService] Recibo enviado con éxito a: ${payload.email}`);
    } catch (error) {
      console.error('[MailService] Error enviando recibo de torneo:', error);
    }
  }
}