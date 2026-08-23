import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RegisterDto, LoginDto } from '@healthcare/contracts';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        role: 'patient',
        fullName: dto.fullName,
        phone: dto.phone,
        timezone: dto.timezone || 'Asia/Kolkata',
        patient: {
          create: {},
        },
      },
    });

    return this.generateTokens(user.id, user.email, user.role, user.fullName);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        title: 'Invalid credentials',
        detail: 'Email or password is incorrect.',
      });
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        title: 'Invalid credentials',
        detail: 'Email or password is incorrect.',
      });
    }

    return this.generateTokens(user.id, user.email, user.role, user.fullName);
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException();
      }

      return this.generateTokens(user.id, user.email, user.role, user.fullName);
    } catch {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        title: 'Invalid refresh token',
        detail: 'Please log in again.',
      });
    }
  }

  private generateTokens(
    userId: string,
    email: string,
    role: string,
    fullName: string,
  ) {
    const payload = { sub: userId, email, role };

    const accessToken = this.jwt.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
      expiresIn: '7d',
    });

    return {
      accessToken,
      refreshToken,
      user: { id: userId, email, fullName, role },
    };
  }
}
