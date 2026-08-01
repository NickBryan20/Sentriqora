import { ALERT_STATUSES, CORRELATION_DIMENSIONS, EVENT_SEVERITIES } from '@aegisflow/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateDetectionRuleDto {
  @ApiProperty({ additionalProperties: true }) @IsObject() condition!: Record<string, unknown>;
  @ApiPropertyOptional({ enum: CORRELATION_DIMENSIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsEnum(CORRELATION_DIMENSIONS, { each: true })
  correlationDimensions?: (typeof CORRELATION_DIMENSIONS)[number][];
  @ApiPropertyOptional({ default: 900 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86_400)
  deduplicationWindowSeconds?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1_000) description?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiProperty({ example: 'auth.failed-burst' }) @Matches(/^[a-z][a-z0-9._-]{2,79}$/u) key!: string;
  @ApiProperty() @IsString() @Length(3, 120) name!: string;
  @ApiProperty({ enum: EVENT_SEVERITIES })
  @IsEnum(EVENT_SEVERITIES)
  severity!: (typeof EVENT_SEVERITIES)[number];
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  threshold?: number;
  @ApiPropertyOptional({ default: 300 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86_400)
  windowSeconds?: number;
}

export class UpdateDetectionRuleDto {
  @ApiPropertyOptional({ additionalProperties: true }) @IsOptional() @IsObject() condition?: Record<
    string,
    unknown
  >;
  @ApiPropertyOptional({ enum: CORRELATION_DIMENSIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsEnum(CORRELATION_DIMENSIONS, { each: true })
  correlationDimensions?: (typeof CORRELATION_DIMENSIONS)[number][];
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86_400)
  deduplicationWindowSeconds?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1_000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 120) name?: string;
  @ApiPropertyOptional({ enum: EVENT_SEVERITIES })
  @IsOptional()
  @IsEnum(EVENT_SEVERITIES)
  severity?: (typeof EVENT_SEVERITIES)[number];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000) threshold?: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(60) @Max(86_400) windowSeconds?: number;
}

export class SetDetectionRuleEnabledDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}

export class ListAlertsDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() assignedMembershipId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(512) cursor?: string;
  @ApiPropertyOptional({ maximum: 100, minimum: 1 })
  @Transform(({ value }) => Number(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ enum: EVENT_SEVERITIES })
  @IsOptional()
  @IsEnum(EVENT_SEVERITIES)
  severity?: (typeof EVENT_SEVERITIES)[number];
  @ApiPropertyOptional({ enum: ALERT_STATUSES })
  @IsOptional()
  @IsEnum(ALERT_STATUSES)
  status?: (typeof ALERT_STATUSES)[number];
}

export class TriageAlertDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  assignedMembershipId?: string | null;
  @ApiProperty({ enum: ['ACKNOWLEDGED', 'CLOSED'] }) @IsEnum(['ACKNOWLEDGED', 'CLOSED']) status!:
    'ACKNOWLEDGED' | 'CLOSED';
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}

export class SuppressAlertDto {
  @ApiProperty() @IsString() @Length(5, 500) reason!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString({ strict: true }) suppressedUntil!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}
