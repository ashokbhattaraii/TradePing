import { Module, forwardRef } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [forwardRef(() => SettingsModule)],
  controllers: [NotificationsController, ChannelsController, TemplatesController, RulesController],
  providers: [NotificationsService, ChannelsService, TemplatesService, RulesService],
  exports: [NotificationsService, ChannelsService, TemplatesService, RulesService],
})
export class NotificationsModule {}
