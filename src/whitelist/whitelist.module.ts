import { Module } from '@nestjs/common';
import { WhitelistController } from './whitelist.controller';
import { WhitelistService } from './whitelist.service';

@Module({ controllers: [WhitelistController], providers: [WhitelistService], exports: [WhitelistService] })
export class WhitelistModule {}
