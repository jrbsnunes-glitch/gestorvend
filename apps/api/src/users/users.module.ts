import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MenuAccessService } from './menu-access.service';
import { UserPermissionsService } from './user-permissions.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, UserPermissionsService, MenuAccessService],
  exports: [UsersService, UserPermissionsService, MenuAccessService],
})
export class UsersModule {}
