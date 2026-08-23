import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS — allow the frontend origin
  app.enableCors({
    origin: process.env.WEB_URL || 'http://localhost:3000',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // RFC 7807 problem+json error responses
  app.useGlobalFilters(new ProblemExceptionFilter());

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('API failed to start:', err);
  process.exit(1);
});
