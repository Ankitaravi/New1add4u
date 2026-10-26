import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { DoctorsModule } from './doctors/doctors.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { PaymentsModule } from './payments/payments.module';
import { LabsModule } from './labs/labs.module';
import { PharmaModule } from './pharma/pharma.module';
import { NotificationsModule } from './notifications/notifications.module';
import { StaffModule } from './staff/staff.module';
import { HealthRecordsModule } from './health-records/health-records.module';
import { ContentModule } from './content/content.module';
import { RatingsModule } from './ratings/ratings.module';
import { AiModule } from './ai/ai.module';
import { AdminModule } from './admin/admin.module';
import { StudentsModule } from './students/students.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { ReferralsModule } from './referrals/referrals.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, DoctorsModule, AppointmentsModule, PaymentsModule, LabsModule, PharmaModule, NotificationsModule, StaffModule, HealthRecordsModule, ContentModule, RatingsModule, AiModule, AdminModule, StudentsModule, HospitalsModule, ReferralsModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
