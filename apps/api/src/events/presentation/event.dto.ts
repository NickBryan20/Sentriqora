import { EVENT_SEVERITIES } from '@aegisflow/contracts';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListEventsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  connectorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ example: 'authentication.failed' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9._-]{1,119}$/u)
  eventType?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100, minimum: 1 })
  @Transform(({ value }) => Number(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: EVENT_SEVERITIES })
  @IsOptional()
  @IsEnum(EVENT_SEVERITIES)
  severity?: (typeof EVENT_SEVERITIES)[number];

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}
