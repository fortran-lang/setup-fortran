program math_test
    implicit none

    real :: a(3) = [1.0, 2.0, 3.0]
    real :: b(3) = [4.0, 5.0, 6.0]
    real :: result

    result = dot_product(a, b)
    print *, "Dot product result:", result

    if (abs(result - 32.0) > 1e-6) then
        print *, "Math check: FAILED"
        stop 4
    end if
    print *, "Math check: OK"
end
