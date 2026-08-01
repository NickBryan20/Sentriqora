import { EVIDENCE_CONTENT_TYPES, EVENT_SEVERITIES, INCIDENT_STATUSES } from '@aegisflow/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListIncidentsDto {
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
  @ApiPropertyOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsOptional()
  @IsBoolean()
  slaBreached?: boolean;
  @ApiPropertyOptional({ enum: INCIDENT_STATUSES })
  @IsOptional()
  @IsEnum(INCIDENT_STATUSES)
  status?: (typeof INCIDENT_STATUSES)[number];
}

export class CreateIncidentDto {
  @ApiProperty({ format: 'uuid', isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  alertIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4_000) description?: string;
  @ApiPropertyOptional({ enum: EVENT_SEVERITIES })
  @IsOptional()
  @IsEnum(EVENT_SEVERITIES)
  severity?: (typeof EVENT_SEVERITIES)[number];
  @ApiProperty() @IsString() @Length(5, 200) title!: string;
}

export class AssignIncidentDto {
  @ApiProperty({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  assignedMembershipId!: string | null;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}

export class TransitionIncidentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 5_000) lessonsLearned?: string;
  @ApiProperty() @IsString() @Length(5, 1_000) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(10, 5_000) rootCause?: string;
  @ApiProperty({ enum: INCIDENT_STATUSES })
  @IsEnum(INCIDENT_STATUSES)
  status!: (typeof INCIDENT_STATUSES)[number];
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}

export class UpdateIncidentAnalysisDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(10, 5_000)
  lessonsLearned?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(10, 5_000)
  rootCause?: string | null;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}

export class AddIncidentCommentDto {
  @ApiProperty() @IsString() @Length(1, 5_000) body!: string;
}

export class RequestEvidenceUploadDto {
  @ApiProperty({ enum: EVIDENCE_CONTENT_TYPES })
  @IsEnum(EVIDENCE_CONTENT_TYPES)
  contentType!: (typeof EVIDENCE_CONTENT_TYPES)[number];
  @ApiProperty() @IsString() @Length(1, 180) fileName!: string;
  @ApiProperty() @Matches(/^[a-f0-9]{64}$/u) sha256!: string;
  @ApiProperty({ maximum: 10_485_760, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(10_485_760)
  sizeBytes!: number;
}

export class CompleteEvidenceUploadDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}

export class UpdateSlaPolicyDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty() @IsInt() @Min(1) @Max(525_600) escalationMinutes!: number;
  @ApiProperty() @IsString() @Length(3, 120) name!: string;
  @ApiProperty() @IsInt() @Min(5) @Max(525_600) resolutionMinutes!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(43_200) responseMinutes!: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}
