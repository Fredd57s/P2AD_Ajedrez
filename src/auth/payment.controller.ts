import { Controller, Post, Param, HttpCode, HttpStatus, Body } from '@nestjs/common';
import { PaymentService } from './payment.service';

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('create-order')
  @HttpCode(HttpStatus.OK)
  async createOrder() {
    return await this.paymentService.createOrder();
  }

  @Post('capture-order/:orderId')
  @HttpCode(HttpStatus.OK)
  async captureOrder(
    @Param('orderId') orderId: string,
    @Body('email') email?: string 
  ) {
    return await this.paymentService.captureOrder(orderId, email);
  }
}