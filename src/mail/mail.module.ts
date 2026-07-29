import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailService } from './mail.service';
import { EmailTask } from './entities/email-task.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EmailTask])],
  providers: [MailService],
  exports: [MailService], // Lo exportamos para usarlo en AuthModule después
})
export class MailModule {}