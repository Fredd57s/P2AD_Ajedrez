import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import axios from 'axios';
import { MailService } from '../mail/mail.service'; // Asegúrate de ajustar la ruta si varía

@Injectable()
export class PaymentService {
  constructor(
    private eventEmitter: EventEmitter2,
    private mailService: MailService // Inyectamos el servicio de correo
  ) {}

  private async getPaypalAccessToken() {
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
    try {
      const response = await axios.post(
        `${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );
      return response.data.access_token;
    } catch (error) {
      throw new HttpException('Error de autenticación con PayPal', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async createOrder() {
    const accessToken = await this.getPaypalAccessToken();
    const amountInDollars = "2.00"; 

    const body = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: `TORNEO-${Date.now()}`,
        description: 'Entrada al Torneo Oficial de Ajedrez',
        amount: { currency_code: 'USD', value: amountInDollars }
      }]
    };

    try {
      const response = await axios.post(`${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`, body, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
      });

      this.eventEmitter.emit('payment.created', { orderId: response.data.id, amount: amountInDollars });
      
      return { id: response.data.id, status: response.data.status };
    } catch (error) {
      this.eventEmitter.emit('payment.failed', { reason: 'Error creando orden' });
      throw new HttpException('Error creando orden PayPal', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async captureOrder(orderId: string, userEmail?: string) { 
    const accessToken = await this.getPaypalAccessToken();

    try {
      const response = await axios.post(
        `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
        {},
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );

      this.eventEmitter.emit('payment.approved', { orderId, status: response.data.status });
      
      // 👇 Usamos EL CORREO DE TU SISTEMA, no el de Sandbox
      if (userEmail && userEmail !== 'correo@desconocido.com') {
        const amountPaid = response.data.purchase_units[0]?.payments?.captures[0]?.amount?.value || "2.00";
        
        // Enviamos el recibo
        this.mailService.sendPaymentReceipt(userEmail, orderId, amountPaid, 'PayPal')
          .catch(e => console.error("Error enviando recibo de torneo:", e));
      }

      return { ok: true, status: response.data.status, capture: response.data };
    } catch (error) {
      this.eventEmitter.emit('payment.failed', { reason: 'Error capturando orden' });
      throw new HttpException('Error capturando orden PayPal', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}