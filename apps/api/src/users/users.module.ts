import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { MenuAccessInterceptor } from './menu-access.interceptor';
import { MenuAccessService } from './menu-access.service';
import { UserPermissionsService } from './user-permissions.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserPermissionsService,
    MenuAccessService,
    { provide: APP_INTERCEPTOR, useClass: MenuAccessInterceptor },
  ],
  exports: [UsersService, UserPermissionsService, MenuAccessService],
})
export class UsersModule {}
