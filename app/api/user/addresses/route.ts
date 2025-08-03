// app/api/user/addresses/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Address creation/update schema
const addressSchema = z.object({
  street: z.string().min(1, 'Street is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  zipCode: z.string().min(1, 'ZIP code is required'),
  country: z.string().default('Morocco'),
  isDefault: z.boolean().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
})

// GET /api/user/addresses?userId=xxx
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return errorResponse('userId parameter is required', 400)
    }

    const addresses = await prisma.address.findMany({
      where: { userId },
      select: {
        id: true,
        street: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
        isDefault: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: [
        { isDefault: 'desc' },
        { createdAt: 'desc' }
      ]
    })

    return successResponse(addresses, 'Addresses retrieved successfully')
  } catch (error) {
    console.error('Get addresses error:', error)
    return errorResponse('Failed to retrieve addresses', 500)
  }
}

// POST /api/user/addresses?userId=xxx
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return errorResponse('userId parameter is required', 400)
    }
    
    const body = await request.json()
    const validatedData = validateQuery(addressSchema, body)
    
    if (!validatedData) {
      return errorResponse('Invalid address data', 400)
    }

    // Verify user exists and is a customer
    const user = await prisma.user.findUnique({
      where: { 
        id: userId,
        role: 'CUSTOMER' 
      }
    })

    if (!user) {
      return errorResponse('Customer not found', 404)
    }

    // If this is being set as default, unset all other default addresses
    if (validatedData.isDefault) {
      await prisma.address.updateMany({
        where: { 
          userId,
          isDefault: true
        },
        data: { isDefault: false }
      })
    }

    // Create new address
    const newAddress = await prisma.address.create({
      data: {
        ...validatedData,
        userId
      },
      select: {
        id: true,
        street: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
        isDefault: true,
        latitude: true,
        longitude: true,
        createdAt: true
      }
    })

    return successResponse(newAddress, 'Address created successfully')
  } catch (error) {
    console.error('Create address error:', error)
    return errorResponse('Failed to create address', 500)
  }
}