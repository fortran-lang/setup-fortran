program iso_fortran_env_test
    use iso_fortran_env, only: real64, error_unit
    implicit none

    real(real64) :: x = 1.23456789012345_real64

    write (*, *) "Value of x (real64):", x
    write (*, *) "Storage size of x (bits):", storage_size(x)

    if (storage_size(x) == 64) then
        write (error_unit, *) "Standard library check: OK"
    else
        write (error_unit, *) "Standard library check: FAILED (Wrong size)"
        stop 1
    end if
end
