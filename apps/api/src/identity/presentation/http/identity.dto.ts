import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterIdentityDto {
  @ApiProperty({ example: 'Alicia Torres' })
  @IsString()
  @Length(2, 120)
  displayName!: string;

  @ApiProperty({ example: 'alicia@example.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Acme Security Lab' })
  @IsString()
  @Length(2, 120)
  organizationName!: string;

  @ApiPropertyOptional({ example: 'acme-security-lab' })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  organizationSlug?: string;

  @ApiProperty({ example: 'Correct-Horse-Battery-2026' })
  @IsString()
  @Length(14, 128)
  password!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'Chrome en portátil personal' })
  @IsString()
  @Length(2, 120)
  deviceName!: string;

  @ApiProperty({ example: 'alicia@example.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty()
  @IsString()
  @Length(14, 128)
  password!: string;
}

export class VerifyMfaLoginDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ description: 'Código TOTP o código de recuperación de un solo uso.' })
  @IsString()
  @Length(6, 32)
  code!: string;

  @ApiProperty({ example: 'Chrome en portátil personal' })
  @IsString()
  @Length(2, 120)
  deviceName!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;
}

export class ConfirmMfaEnrollmentDto {
  @ApiProperty({ example: '123456', pattern: '^\\d{6}$' })
  @Matches(/^\d{6}$/u)
  code!: string;
}

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Incident Response Lab' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ example: 'incident-response-lab' })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  slug?: string;
}

export class CreateInvitationDto {
  @ApiProperty({ example: 'analyst@example.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roleId!: string;
}

export class AcceptInvitationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationId!: string;

  @ApiProperty({ description: 'Token opaco entregado una única vez al crear la invitación.' })
  @IsString()
  @Length(32, 256)
  token!: string;
}

export class CreateRoleDto {
  @ApiProperty({ example: 'Can investigate security events.' })
  @IsString()
  @Length(2, 240)
  description!: string;

  @ApiProperty({ example: 'incident-responder' })
  @Matches(/^[a-z][a-z0-9._-]{1,63}$/u)
  key!: string;

  @ApiProperty({ example: 'Incident responder' })
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiProperty({ example: ['organization.read', 'member.read'], type: [String] })
  @ArrayMaxSize(50)
  @ArrayMinSize(1)
  @IsArray()
  @IsString({ each: true })
  @MinLength(3, { each: true })
  @MaxLength(100, { each: true })
  permissions!: string[];
}

export class ReplaceMembershipRolesDto {
  @ApiProperty({ format: 'uuid', isArray: true })
  @ArrayMaxSize(10)
  @ArrayMinSize(1)
  @IsArray()
  @IsUUID('all', { each: true })
  roleIds!: string[];
}
